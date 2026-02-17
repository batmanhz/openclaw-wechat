import { WechatyBuilder, Contact, Room, Message } from 'wechaty';
import { FileBox } from 'file-box';
import { EventEmitter } from 'events';

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

  constructor(config: WechatyClientConfig = {}) {
    super();
    this.config = config;
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

  async start(): Promise<void> {
    this.bot = WechatyBuilder.build({
      name: this.config.name || 'openclaw-wechat',
      puppet: this.config.puppet || 'wechaty-puppet-wechat',
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
      });
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
    return {
      msgId: msg?.id || Date.now(),
      newMsgId: msg?.id || Date.now(),
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
      
      return {
        msgId: msg?.id || Date.now(),
        newMsgId: msg?.id || Date.now(),
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
    await this.bot.stop();
  }
}
