import { WechatyBuilder, Contact, Room, Message } from 'wechaty';
import { FileBox } from 'file-box';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

export interface MessagePayload {
  id: string;
  type: 'text' | 'image' | 'file' | 'link' | 'unknown';
  sender: { id: string; name: string };
  recipient: { id: string };
  content: string;
  timestamp: number;
  group?: { id: string; name: string };
  mention?: string[];
  isMentioned?: boolean;
  imageUrl?: string;
  linkUrl?: string;
  linkTitle?: string;
  linkDescription?: string;
  raw: any;
}

export interface WechatyClientConfig {
  name?: string;
  puppet?: string;
  puppetToken?: string;
  memoryCardPath?: string; // 会话存储路径
  reconnectInterval?: number; // 重连间隔基数（毫秒）
  maxReconnectAttempts?: number; // 最大重连次数
  heartbeatInterval?: number; // 心跳检测间隔（毫秒）
  contactsCacheTtl?: number; // 联系人缓存时间（毫秒，默认5分钟）
}

export interface ContactInfo {
  id: string;
  name: string;
  avatar?: string;
  alias?: string;
  isFriend: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  memberCount?: number;
  owner?: string;
}

export interface RoomMemberInfo {
  id: string;
  name: string;
  avatar?: string;
  roomAlias?: string;
}

export interface AddressList {
  friends: ContactInfo[];
  chatrooms: RoomInfo[];
  updateTime: number;
}

export class WechatyClient extends EventEmitter {
  private bot: any;
  private config: WechatyClientConfig;
  private isLoggedIn: boolean = false;
  private wcId: string = '';
  private nickName: string = '';
  private qrCodeUrl: string = '';
  private loginSessionId: string = '';
  private processedMessages: Set<string> = new Set();
  private maxMessageHistory: number = 1000;

  // 重连相关
  private isReconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // 心跳检测相关
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastHeartbeatTime: number = 0;
  private heartbeatMissedCount: number = 0;
  private maxMissedHeartbeats: number = 3;

  // 联系人缓存
  private contactsCache: AddressList | null = null;
  private contactsCacheTime: number = 0;
  private contactsCacheTtl: number = 5 * 60 * 1000; // 默认5分钟
  private roomMembersCache: Map<string, RoomMemberInfo[]> = new Map();

  constructor(config: WechatyClientConfig = {}) {
    super();
    this.config = {
      name: 'openclaw-wechat',
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      contactsCacheTtl: 5 * 60 * 1000,
      ...config,
    };
    this.contactsCacheTtl = this.config.contactsCacheTtl || 5 * 60 * 1000;
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    // 每5分钟清理一次过期消息
    setInterval(
      () => {
        if (this.processedMessages.size > this.maxMessageHistory) {
          const messagesToDelete = Array.from(this.processedMessages).slice(
            0,
            this.processedMessages.size - this.maxMessageHistory
          );
          messagesToDelete.forEach((id) => this.processedMessages.delete(id));
          console.log(`Cleaned up ${messagesToDelete.length} old messages`);
        }
      },
      5 * 60 * 1000
    );
  }

  async start(): Promise<void> {
    // 捕获 wechat4u 内部的 uncaughtException
    process.on('uncaughtException', (error: Error) => {
      // 忽略 wechat4u 在 logout/start 过渡期间的已知错误
      if (
        error.message &&
        error.message.includes("Cannot read properties of undefined (reading 'start')")
      ) {
        console.log('[DEBUG] Ignored wechat4u internal transition error');
        return;
      }
      // 处理 "must logout first before login again" 错误
      if (error.message && error.message.includes('must logout first before login again')) {
        console.log('[DEBUG] Detected login conflict, need to restart bot properly');
        console.log('[DEBUG] Stopping bot and scheduling restart...');
        this.stop();
        setTimeout(() => {
          console.log('[DEBUG] Restarting bot after login conflict...');
          this.start().catch((err) => {
            console.error('[DEBUG] Failed to restart bot:', err.message);
          });
        }, 5000);
        return;
      }
      // 其他未捕获的错误重新抛出
      throw error;
    });

    await this.createAndStartBot();
    this.startHeartbeat();
  }

  /**
   * 创建并启动 Bot 实例
   */
  private async createAndStartBot(): Promise<void> {
    // 确保旧实例已停止（但不清除引用，避免 wechat4u 内部错误）
    if (this.bot) {
      try {
        await this.bot.stop();
      } catch (e) {
        // 忽略停止错误
      }
    }

    // 创建新实例
    this.bot = WechatyBuilder.build({
      name: this.config.name || 'openclaw-wechat',
      puppet: (this.config.puppet || 'wechaty-puppet-wechat4u') as any,
      puppetOptions: {
        token: this.config.puppetToken,
      },
    });

    this.setupEventHandlers();
    await this.bot.start();
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
        this.reconnectAttempts = 0; // 重置重连计数
        console.log(`User ${user.name()} logged in`);
        this.emit('login', { wcId: this.wcId, nickName: this.nickName });
      })
      .on('logout', (user: Contact) => {
        this.isLoggedIn = false;
        console.log(`User ${user.name()} logged out`);
        this.emit('logout', user);
      })
      .on('message', async (message: Message) => {
        await this.handleMessage(message);
      })
      .on('error', (error: Error) => {
        console.error('Wechaty error:', error);
        this.emit('error', error);

        const errorMessage = error.message || '';
        const errorStack = error.stack || '';

        // 需要重新扫码登录的错误（登录状态失效）
        const isLoginExpiredError =
          errorMessage.includes('1101') ||
          errorMessage.includes('1102') ||
          errorMessage.includes('1103');

        // 临时性网络错误（可自动恢复）
        const isTemporaryError =
          errorMessage.includes('400 != 400') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('AggregateError') ||
          errorMessage.includes('ECONNREFUSED') ||
          errorMessage.includes('socket') ||
          errorMessage.includes('Parse Error') ||
          errorMessage.includes('no this.wechat4u.contacts') ||
          errorMessage.includes('batchGetContact') ||
          errorMessage.includes('同步失败') ||
          errorMessage.includes('TLS connection') ||
          errorMessage.includes('disconnected before secure') ||
          errorStack.includes('axios') ||
          errorStack.includes('fetch');

        const isLogoutError = errorMessage.includes('already logout');

        if (isLoginExpiredError) {
          // 登录状态失效，需要重新扫码
          console.log('[INFO] Login expired (1101/1102/1103), please re-scan QR code...');
          this.isLoggedIn = false;
          this.isReconnecting = false;
          this.reconnectAttempts = 0;
          this.emit('loginExpired', { reason: errorMessage });
          // 不自动重建 bot，等待 wechaty 内部触发 scan 事件
        } else if (isLogoutError) {
          console.log('[INFO] Logout detected, waiting for new login...');
        } else if (!isTemporaryError) {
          console.log('[INFO] Non-temporary error, triggering reconnect...');
          this.handleDisconnect('error', error);
        } else {
          console.log('[INFO] Temporary error, ignoring...');
        }
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

      console.log(
        `Reconnect attempt ${this.reconnectAttempts}/${maxAttempts} in ${Math.round(delay / 1000)}s...`
      );
      this.emit('reconnecting', { attempt: this.reconnectAttempts, maxAttempts, delay });

      await new Promise((resolve) => {
        this.reconnectTimer = setTimeout(resolve, delay);
      });

      try {
        // 重新创建并启动 Bot
        console.log('Restarting Wechaty client...');
        await this.createAndStartBot();

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
        console.warn(
          `Heartbeat: Login state mismatch detected. Expected: ${this.isLoggedIn}, Actual: ${isLoggedIn}`
        );
        this.heartbeatMissedCount++;
      } else if (this.isLoggedIn) {
        // 登录状态下，检查是否能获取用户信息
        try {
          const user = this.bot.currentUser;
          if (user) {
            this.heartbeatMissedCount = 0;
            this.lastHeartbeatTime = Date.now();
            this.emit('heartbeat', { status: 'ok', timestamp: this.lastHeartbeatTime });
            return;
          }
        } catch (e) {
          logger.warn('Heartbeat: Failed to get user info');
          this.heartbeatMissedCount++;
        }
      } else {
        // 未登录状态，心跳正常
        this.heartbeatMissedCount = 0;
        return;
      }

      // 如果连续多次心跳失败，触发重连
      if (this.heartbeatMissedCount >= this.maxMissedHeartbeats) {
        console.error(
          `Heartbeat: Missed ${this.heartbeatMissedCount} heartbeats, triggering reconnect`
        );
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

      // 获取消息内容并检测是否是加密图片（XML格式）
      const content = message.text() || '';
      const isEncryptedImage = content.includes('<img') && content.includes('aeskey');

      // 如果检测到加密图片，强制类型为 image
      let messageType = this.mapMessageType(type);
      logger.info(`Message type from map: ${messageType}, isEncryptedImage: ${isEncryptedImage}`);
      if (isEncryptedImage) {
        messageType = 'image';
        logger.info('Detected encrypted image message from XML content');
      }

      const payload: MessagePayload = {
        id: message.id,
        type: messageType,
        sender: {
          id: contact.id,
          name: contact.name() || contact.id,
        },
        recipient: {
          id: this.wcId,
        },
        content: content,
        timestamp: message.date().getTime(),
        raw: message,
      };

      // 处理图片消息 - 提取图片Base64数据
      logger.info(`Checking if should extract image: payload.type=${payload.type}`);
      if (payload.type === 'image' || payload.type === 'file') {
        try {
          logger.info('Extracting image data...');
          const fileBox = await message.toFileBox();
          const base64 = await fileBox.toBase64();
          const mimeType = (fileBox as any).mimeType || 'image/jpeg';

          // 限制图片大小：如果 base64 超过 3MB，则保存到文件
          const MAX_BASE64_SIZE = 3 * 1024 * 1024; // 3MB
          if (base64.length > MAX_BASE64_SIZE) {
            logger.info(`Image too large (${base64.length} chars), saving to file...`);
            // 保存到临时文件 - 使用与 bot.ts 相同的目录
            const tempDir = path.join(os.tmpdir(), 'openclaw-wechat-images');
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true });
            }
            const fileName = `img-${Date.now()}-${Math.random().toString(36).substring(2, 10)}.jpg`;
            const filePath = path.join(tempDir, fileName);

            // 将 base64 转换为 buffer 并保存
            const buffer = Buffer.from(base64, 'base64');
            fs.writeFileSync(filePath, buffer);

            // 直接返回本地文件路径，让 OpenClaw 直接访问
            payload.imageUrl = filePath;
            logger.info(`Image saved to: ${filePath} (${buffer.length} bytes)`);
          } else {
            payload.imageUrl = `data:${mimeType};base64,${base64}`;
            logger.info(
              `Image extracted successfully: ${payload.imageUrl.substring(0, 50)}... (${base64.length} chars)`
            );
          }
        } catch (e) {
          logger.error('Failed to extract image:', e);
          // 即使提取失败，也保留图片类型标记
          payload.type = 'image';
        }
      }

      // 处理链接消息 - 提取链接信息
      if (payload.type === 'link') {
        try {
          logger.info(`Link message XML: ${content}`);

          // 从 XML 格式中提取链接信息
          const titleMatch = content.match(/<title>(.*?)<\/title>/);
          const descMatch = content.match(/<des>(.*?)<\/des>/);

          // 尝试多种 URL 匹配模式
          // 模式1: <url><![CDATA[xxx]]></url>
          let urlMatch = content.match(/<url><!\[CDATA\[(.*?)\]\]><\/url>/);
          // 模式2: <url>xxx</url>
          if (!urlMatch) {
            urlMatch = content.match(/<url>(.*?)<\/url>/);
          }
          // 模式3: 匹配 mp.weixin.qq.com/s/ 开头的短链接
          if (!urlMatch) {
            urlMatch = content.match(/(https?:\/\/mp\.weixin\.qq\.com\/s\/[a-zA-Z0-9_-]+)/);
          }

          if (titleMatch) {
            payload.linkTitle = titleMatch[1];
          }
          if (descMatch) {
            payload.linkDescription = descMatch[1];
          }

          if (urlMatch) {
            // 解码 HTML 实体
            payload.linkUrl = urlMatch[1]
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"');
          }

          // 构建发送给 AI 的内容
          let linkContent = '';
          if (payload.linkTitle) {
            linkContent += `标题: ${payload.linkTitle}\n`;
          }
          if (payload.linkDescription) {
            linkContent += `描述: ${payload.linkDescription}\n`;
          }
          if (payload.linkUrl) {
            linkContent += `链接: ${payload.linkUrl}`;
          }

          if (linkContent) {
            payload.content = linkContent;
          }

          logger.info(`Link extracted - title: ${payload.linkTitle}, url: ${payload.linkUrl}`);
        } catch (e) {
          logger.error('Failed to extract link info:', e);
        }
      }

      // 处理群聊消息
      if (room) {
        payload.group = {
          id: room.id,
          name: (await room.topic()) || room.id,
        };

        // 处理@提及
        try {
          const mentionList = await message.mentionList();
          if (mentionList && mentionList.length > 0) {
            payload.mention = mentionList.map((m) => m.id);
            // 检查是否@了机器人自己
            payload.isMentioned = mentionList.some((m) => m.id === this.wcId);
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

      console.log(
        `Received message: ${payload.type} from ${payload.sender.name} in ${payload.group ? 'group' : 'private'}`
      );
      this.emit('message', payload);
    } catch (error: any) {
      console.error('Error handling message:', error.message);
    }
  }

  private mapMessageType(type: any): MessagePayload['type'] {
    const typeMap: Record<number, MessagePayload['type']> = {
      7: 'text', // MessageType.Text
      6: 'image', // MessageType.Image
      1: 'file', // MessageType.Attachment
      14: 'link', // MessageType.Url / Link
    };
    return typeMap[type] || 'unknown';
  }

  async sendText(to: string, content: string): Promise<any> {
    logger.debug('[DEBUG sendText] bot exists:', { botExists: !!this.bot });
    logger.debug('[DEBUG sendText] bot.isLoggedIn:', { botIsLoggedIn: this.bot?.isLoggedIn });
    logger.debug('[DEBUG sendText] this.isLoggedIn:', { isLoggedIn: this.isLoggedIn });
    logger.debug('[DEBUG sendText] params:', { to, contentLength: content?.length });

    if (!to || !to.trim()) {
      throw new Error('Target ID (to) is empty or invalid');
    }

    if (!this.bot?.isLoggedIn) {
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
      logger.error('Error sending image:', error);
      throw new Error(`Failed to send image: ${error.message}`);
    }
  }

  async getContacts(): Promise<{ friends: string[]; chatrooms: string[] }> {
    const addressList = await this.getAddressList();
    return {
      friends: addressList.friends.map((f) => f.id),
      chatrooms: addressList.chatrooms.map((r) => r.id),
    };
  }

  /**
   * 获取详细通讯录信息（带缓存）
   */
  async getAddressList(forceRefresh: boolean = false): Promise<AddressList> {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in');
    }

    // 检查缓存是否有效
    const now = Date.now();
    if (
      !forceRefresh &&
      this.contactsCache &&
      now - this.contactsCacheTime < this.contactsCacheTtl
    ) {
      console.log(
        `Returning cached address list (${this.contactsCache.friends.length} friends, ${this.contactsCache.chatrooms.length} rooms)`
      );
      return this.contactsCache;
    }

    console.log('Fetching address list from WeChat...');

    try {
      // 获取所有联系人
      const contacts = await this.bot.Contact.findAll();
      const friends: ContactInfo[] = [];

      for (const contact of contacts) {
        try {
          // 只保留好友（不是公众号等）
          if (contact.friend()) {
            friends.push({
              id: contact.id,
              name: contact.name() || contact.id,
              alias: contact.alias() || undefined,
              avatar: await this.getContactAvatar(contact),
              isFriend: true,
            });
          }
        } catch (e) {
          // 跳过无法获取的联系人
          console.warn(`Failed to get contact info for ${contact.id}:`, (e as Error).message);
        }
      }

      // 获取所有群
      const rooms = await this.bot.Room.findAll();
      const chatrooms: RoomInfo[] = [];

      for (const room of rooms) {
        try {
          const topic = await room.topic();
          const owner = await room.owner();

          chatrooms.push({
            id: room.id,
            name: topic || room.id,
            memberCount: await this.getRoomMemberCount(room),
            owner: owner?.id,
          });
        } catch (e) {
          console.warn(`Failed to get room info for ${room.id}:`, (e as Error).message);
        }
      }

      // 更新缓存
      this.contactsCache = {
        friends,
        chatrooms,
        updateTime: now,
      };
      this.contactsCacheTime = now;

      console.log(`Address list updated: ${friends.length} friends, ${chatrooms.length} rooms`);

      return this.contactsCache;
    } catch (error: any) {
      console.error('Failed to fetch address list:', error.message);
      // 如果有缓存，返回缓存数据（即使已过期）
      if (this.contactsCache) {
        console.log('Returning stale cache due to error');
        return this.contactsCache;
      }
      throw error;
    }
  }

  /**
   * 获取群成员列表
   */
  async getRoomMembers(roomId: string): Promise<RoomMemberInfo[]> {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in');
    }

    // 检查缓存
    const cached = this.roomMembersCache.get(roomId);
    if (cached && Date.now() - this.contactsCacheTime < this.contactsCacheTtl) {
      return cached;
    }

    const room = await this.bot.Room.find({ id: roomId });
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    try {
      const members = await room.memberAll();
      const memberList: RoomMemberInfo[] = [];

      for (const member of members) {
        try {
          const alias = await room.alias(member);
          memberList.push({
            id: member.id,
            name: member.name() || member.id,
            avatar: await this.getContactAvatar(member),
            roomAlias: alias || undefined,
          });
        } catch (e) {
          console.warn(`Failed to get member info for ${member.id}:`, (e as Error).message);
        }
      }

      // 更新缓存
      this.roomMembersCache.set(roomId, memberList);
      return memberList;
    } catch (error: any) {
      console.error(`Failed to get room members for ${roomId}:`, error.message);
      throw error;
    }
  }

  /**
   * 清除联系人缓存
   */
  clearContactsCache(): void {
    this.contactsCache = null;
    this.contactsCacheTime = 0;
    this.roomMembersCache.clear();
    console.log('Contacts cache cleared');
  }

  /**
   * 获取联系人头像URL
   */
  private async getContactAvatar(contact: Contact): Promise<string | undefined> {
    try {
      // 尝试获取头像
      const avatar = await contact.avatar();
      if (avatar) {
        return await avatar.toBase64();
      }
    } catch (e) {
      // 头像获取失败，忽略
    }
    return undefined;
  }

  /**
   * 获取群成员数量
   */
  private async getRoomMemberCount(room: Room): Promise<number | undefined> {
    try {
      const members = await room.memberAll();
      return members.length;
    } catch (e) {
      return undefined;
    }
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

  async logout(): Promise<void> {
    console.log('Forcing logout...');
    this.isLoggedIn = false;
    this.wcId = '';
    this.nickName = '';
    this.qrCodeUrl = '';
    this.reconnectAttempts = 0;
    this.isReconnecting = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();

    // 删除 session 文件
    try {
      const mcPath = path.join(process.cwd(), `${this.config.name}.memory-card.json`);
      if (fs.existsSync(mcPath)) {
        fs.unlinkSync(mcPath);
        console.log('Session file deleted');
      }
    } catch (e) {
      console.log('Failed to clear session:', (e as Error).message);
    }

    // 完全重建 bot 实例
    console.log('Rebuilding bot for new login...');
    try {
      await this.createAndStartBot();
      console.log('Logout complete. Ready for new login.');
    } catch (e: any) {
      console.log('Failed to rebuild bot:', e.message);
      console.log('Logout complete. Please restart bridge manually.');
    }

    this.emit('logout', null);
  }
}
