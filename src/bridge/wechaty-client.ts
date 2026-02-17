import { WechatyBuilder, Contact, Room, Message } from 'wechaty';
import { FileBox } from 'file-box';
import { EventEmitter } from 'events';
import { MemoryCard } from 'memory-card';
import * as fs from 'fs';
import * as path from 'path';

export interface MessagePayload {
  id: string;
  type: 'text' | 'image' | 'file' | 'unknown';
  sender: { id: string; name: string };
  recipient: { id: string };
  content: string;
  timestamp: number;
  group?: { id: string; name: string };
  mention?: string[];  // @提及的用户列表
  isMentioned?: boolean;  // 是否@了机器人
  raw: any;
}

export interface WechatyClientConfig {
  name?: string;
  puppet?: string;
  puppetToken?: string;
  memoryCardPath?: string;  // 会话存储路径
  reconnectInterval?: number;  // 重连间隔基数（毫秒）
  maxReconnectAttempts?: number;  // 最大重连次数
  heartbeatInterval?: number;  // 心跳检测间隔（毫秒）
}

export class WechatyClient extends EventEmitter {
  private bot: any;
  private config: WechatyClientConfig;
  private isLoggedIn: boolean = false;
  private wcId: string = '';
  private nickName: string = '';
  private qrCodeUrl: string = '';
  private loginSessionId: string = '';
  private processedMessages: Set<string> = new Set();  // 消息去重
  private maxMessageHistory: number = 1000;  // 最大消息历史数量
  private memoryCard: MemoryCard | null = null;
  private memoryCardPath: string = '';
  
  // 自动重连相关
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting: boolean = false;
  
  // 心跳检测相关
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastHeartbeatTime: number = 0;
  private heartbeatMissedCount: number = 0;
  private maxMissedHeartbeats: number = 3;

  constructor(config: WechatyClientConfig = {}) {
    super();
    this.config = {
      name: 'openclaw-wechat',
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      ...config,
    };
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    // 每5分钟清理一次过期消息
    setInterval(() => {
      if (this.processedMessages.size > this.maxMessageHistory) {
        const messagesToDelete = Array.from(this.processedMessages).slice(0, this.processedMessages.size - this.maxMessageHistory);
        messagesToDelete.forEach(id => this.processedMessages.delete(id));
        console.log(`Cleaned up ${messagesToDelete.length} old messages`);
      }
    }, 5 * 60 * 1000);
  }

  /**
   * 初始化 MemoryCard 会话存储
   */
  private async initMemoryCard(): Promise<void> {
    try {
      // 配置会话存储路径
      const dataDir = this.config.memoryCardPath || './data';
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      this.memoryCardPath = path.join(dataDir, `${this.config.name}.memory-card.json`);
      console.log(`MemoryCard path: ${this.memoryCardPath}`);
      
      // 加载已有的会话数据
      this.memoryCard = new MemoryCard({
        name: this.config.name,
      });
      
      if (fs.existsSync(this.memoryCardPath)) {
        console.log('Loading existing session from MemoryCard...');
        await this.memoryCard.load();
        console.log('Session loaded successfully');
      }
    } catch (error: any) {
      console.error('Failed to initialize MemoryCard:', error.message);
      this.memoryCard = null;
    }
  }

  /**
   * 保存会话到 MemoryCard
   */
  private async saveSession(): Promise<void> {
    try {
      if (this.memoryCard && this.isLoggedIn) {
        // 保存登录状态信息
        await this.memoryCard.set('loginState', {
          wcId: this.wcId,
          nickName: this.nickName,
          timestamp: Date.now(),
        });
        await this.memoryCard.save();
        console.log('Session saved to MemoryCard');
      }
    } catch (error: any) {
      console.error('Failed to save session:', error.message);
    }
  }

  /**
   * 从 MemoryCard 恢复会话
   */
  private async restoreSession(): Promise<boolean> {
    try {
      if (this.memoryCard) {
        const loginState = await this.memoryCard.get('loginState');
        if (loginState) {
          console.log(`Found previous session for: ${loginState.nickName} (${loginState.wcId})`);
          return true;
        }
      }
    } catch (error: any) {
      console.error('Failed to restore session:', error.message);
    }
    return false;
  }

  async start(): Promise<void> {
    // 初始化 MemoryCard
    await this.initMemoryCard();
    
    // 检查是否有可恢复的会话
    const hasSession = await this.restoreSession();
    if (hasSession) {
      console.log('Attempting to restore previous session...');
    }

    this.bot = WechatyBuilder.build({
      name: this.config.name || 'openclaw-wechat',
      puppet: (this.config.puppet || 'wechaty-puppet-wechat') as any,
      puppetOptions: {
        token: this.config.puppetToken,
      },
    });

    this.setupEventHandlers();
    await this.bot.start();
    
    // 启动心跳检测
    this.startHeartbeat();
  }

  private setupEventHandlers(): void {
    this.bot
      .on('scan', (qrcode: string, status: number) => {
        this.qrCodeUrl = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
        this.loginSessionId = `session-${Date.now()}`;
        console.log(`Scan QR Code to login: ${status}`);
        console.log(this.qrCodeUrl);
        this.emit('scan', this.qrCodeUrl, this.loginSessionId);
      })
      .on('login', (user: Contact) => {
        this.isLoggedIn = true;
        this.wcId = user.id;
        this.nickName = user.name();
        this.reconnectAttempts = 0;  // 重置重连计数
        console.log(`User ${user.name()} logged in`);
        this.emit('login', { wcId: this.wcId, nickName: this.nickName });
        
        // 保存会话到 MemoryCard
        this.saveSession();
      })
      .on('logout', (user: Contact) => {
        this.isLoggedIn = false;
        console.log(`User ${user.name()} logged out`);
        this.emit('logout', user);
        
        // 清除会话数据
        if (this.memoryCard) {
          this.memoryCard.delete('loginState');
          this.memoryCard.save().catch((e: any) => console.error('Failed to clear session:', e));
        }
      })
      .on('message', async (message: Message) => {
        await this.handleMessage(message);
      })
      .on('error', (error: Error) => {
        console.error('Wechaty error:', error);
        this.emit('error', error);
        
        // 触发自动重连
        this.handleDisconnect('error', error);
      });
  }

  /**
   * 处理断线事件
   */
  private handleDisconnect(type: string, error?: Error): void {
    if (this.isReconnecting || !this.isLoggedIn) {
      return;
    }

    console.log(`Connection lost (${type}), initiating reconnect...`);
    this.isReconnecting = true;
    this.reconnect();
  }

  /**
   * 指数退避重连
   */
  private async reconnect(): Promise<void> {
    const maxAttempts = this.config.maxReconnectAttempts || 10;
    
    while (this.reconnectAttempts < maxAttempts) {
      this.reconnectAttempts++;
      
      // 计算退避延迟（指数退避，最大60秒）
      const baseDelay = this.config.reconnectInterval || 5000;
      const delay = Math.min(baseDelay * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
      
      console.log(`Reconnect attempt ${this.reconnectAttempts}/${maxAttempts} in ${Math.round(delay/1000)}s...`);
      this.emit('reconnecting', { attempt: this.reconnectAttempts, maxAttempts, delay });
      
      await new Promise(resolve => {
        this.reconnectTimer = setTimeout(resolve, delay);
      });
      
      try {
        // 尝试停止当前连接
        try {
          await this.bot.stop();
        } catch (e) {
          // 忽略停止错误
        }
        
        // 重新启动
        console.log('Restarting Wechaty client...');
        await this.bot.start();
        
        console.log('Reconnected successfully!');
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.emit('reconnected');
        return;
      } catch (error: any) {
        console.error(`Reconnect attempt ${this.reconnectAttempts} failed:`, error.message);
        this.emit('reconnectFailed', { attempt: this.reconnectAttempts, error: error.message });
      }
    }
    
    // 超过最大重连次数
    console.error(`Failed to reconnect after ${maxAttempts} attempts`);
    this.isReconnecting = false;
    this.emit('reconnectExhausted', { maxAttempts });
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    const interval = this.config.heartbeatInterval || 30000;
    console.log(`Starting heartbeat check every ${interval}ms`);
    
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, interval);
  }

  /**
   * 检查心跳状态
   */
  private async checkHeartbeat(): Promise<void> {
    try {
      // 检查 Wechaty 状态
      const isLoggedIn = this.bot?.isLoggedIn;
      
      if (this.isLoggedIn !== isLoggedIn) {
        console.warn(`Heartbeat: Login state mismatch detected. Expected: ${this.isLoggedIn}, Actual: ${isLoggedIn}`);
        this.heartbeatMissedCount++;
      } else if (this.isLoggedIn) {
        // 登录状态下，检查是否能获取用户信息
        try {
          const user = this.bot.userSelf();
          if (user) {
            this.heartbeatMissedCount = 0;
            this.lastHeartbeatTime = Date.now();
            this.emit('heartbeat', { status: 'ok', timestamp: this.lastHeartbeatTime });
            return;
          }
        } catch (e) {
          console.warn('Heartbeat: Failed to get user info');
          this.heartbeatMissedCount++;
        }
      } else {
        // 未登录状态，心跳正常
        this.heartbeatMissedCount = 0;
        return;
      }
      
      // 如果连续多次心跳失败，触发重连
      if (this.heartbeatMissedCount >= this.maxMissedHeartbeats) {
        console.error(`Heartbeat: Missed ${this.heartbeatMissedCount} heartbeats, triggering reconnect`);
        this.emit('heartbeatFailed', { missedCount: this.heartbeatMissedCount });
        this.handleDisconnect('heartbeat');
      }
    } catch (error: any) {
      console.error('Heartbeat check failed:', error.message);
      this.heartbeatMissedCount++;
    }
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 获取重连状态
   */
  getReconnectStatus() {
    return {
      isReconnecting: this.isReconnecting,
      attempts: this.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts || 10,
    };
  }

  /**
   * 获取心跳状态
   */
  getHeartbeatStatus() {
    return {
      lastHeartbeat: this.lastHeartbeatTime,
      missedCount: this.heartbeatMissedCount,
      maxMissed: this.maxMissedHeartbeats,
      interval: this.config.heartbeatInterval || 30000,
    };
  }

  private async handleMessage(message: Message): Promise<void> {
    try {
      // 消息去重
      if (this.processedMessages.has(message.id)) {
        console.log(`Duplicate message ignored: ${message.id}`);
        return;
      }
      this.processedMessages.add(message.id);

      const contact = message.talker();
      const room = message.room();
      const type = message.type();

      // 忽略自己发送的消息
      if (message.self()) {
        return;
      }

      const payload: MessagePayload = {
        id: message.id,
        type: this.mapMessageType(type),
        sender: {
          id: contact.id,
          name: contact.name() || contact.id,
        },
        recipient: {
          id: this.wcId,
        },
        content: message.text() || '',
        timestamp: message.date().getTime(),
        raw: message,
      };

      // 处理群聊消息
      if (room) {
        payload.group = {
          id: room.id,
          name: await room.topic() || room.id,
        };

        // 处理@提及
        try {
          const mentionList = await message.mentionList();
          if (mentionList && mentionList.length > 0) {
            payload.mention = mentionList.map(m => m.id);
            // 检查是否@了机器人自己
            payload.isMentioned = mentionList.some(m => m.id === this.wcId);
          }
        } catch (e) {
          // 获取@列表失败，继续处理
        }
      }

      // 忽略其他类型消息
      if (payload.type === 'unknown') {
        console.log(`Ignoring unknown message type: ${type}`);
        return;
      }

      console.log(`Received message: ${payload.type} from ${payload.sender.name} in ${payload.group ? 'group' : 'private'}`);
      this.emit('message', payload);
    } catch (error: any) {
      console.error('Error handling message:', error.message);
    }
  }

  private mapMessageType(type: any): MessagePayload['type'] {
    const typeMap: Record<number, MessagePayload['type']> = {
      7: 'text',    // MessageType.Text
      3: 'image',   // MessageType.Image
      6: 'file',    // MessageType.Attachment
    };
    return typeMap[type] || 'unknown';
  }

  async sendText(to: string, content: string): Promise<any> {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in');
    }

    // 先尝试作为联系人查找
    let target: Contact | Room | null = await this.bot.Contact.find({ id: to });
    
    // 如果没找到，尝试作为群查找
    if (!target && to.includes('@chatroom')) {
      target = await this.bot.Room.find({ id: to });
    }

    if (!target) {
      throw new Error(`Target ${to} not found`);
    }

    const msg = await target.say(content);
    const msgId = (msg as any)?.id || Date.now();
    return {
      msgId,
      newMsgId: msgId,
      createTime: Date.now(),
    };
  }

  async sendImage(to: string, imageUrl: string): Promise<any> {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in');
    }

    try {
      // 查找目标
      let target: Contact | Room | null = await this.bot.Contact.find({ id: to });
      
      if (!target && to.includes('@chatroom')) {
        target = await this.bot.Room.find({ id: to });
      }

      if (!target) {
        throw new Error(`Target ${to} not found`);
      }

      // 从 URL 创建 FileBox
      const fileBox = FileBox.fromUrl(imageUrl);
      
      // 发送图片
      const msg = await target.say(fileBox);
      const msgId = (msg as any)?.id || Date.now();
      
      return {
        msgId,
        newMsgId: msgId,
        createTime: Date.now(),
      };
    } catch (error: any) {
      console.error('Error sending image:', error.message);
      throw new Error(`Failed to send image: ${error.message}`);
    }
  }

  async getContacts(): Promise<{ friends: string[]; chatrooms: string[] }> {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in');
    }

    const contacts = await this.bot.Contact.findAll();
    const rooms = await this.bot.Room.findAll();

    return {
      friends: contacts.map((c: Contact) => c.id),
      chatrooms: rooms.map((r: Room) => r.id),
    };
  }

  getStatus() {
    return {
      valid: true,
      isLoggedIn: this.isLoggedIn,
      wcId: this.wcId,
      nickName: this.nickName,
      qrCodeUrl: this.qrCodeUrl,
      sessionId: this.loginSessionId,
    };
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.bot.stop();
  }
}
