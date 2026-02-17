import express from 'express';
import { WechatyClient, MessagePayload } from './wechaty-client.js';

export interface BridgeConfig {
  server: {
    port: number;
    host: string;
  };
  wechaty: {
    name?: string;
    puppet?: string;
    puppetToken?: string;
  };
}

export class BridgeServer {
  private app: express.Application;
  private client: WechatyClient;
  private config: BridgeConfig;
  private webhookUrl: string = '';

  constructor(config: BridgeConfig) {
    this.config = config;
    this.app = express();
    this.client = new WechatyClient(config.wechaty);
    this.setupMiddleware();
    this.setupRoutes();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // 账号状态
    this.app.get('/v1/account/status', (req, res) => {
      const status = this.client.getStatus();
      res.json({
        valid: status.valid,
        isLoggedIn: status.isLoggedIn,
        wcId: status.wcId,
        nickName: status.nickName,
        error: null,
      });
    });

    // 获取登录二维码
    this.app.post('/v1/iPadLogin', (req, res) => {
      const status = this.client.getStatus();
      res.json({
        wId: status.sessionId || `session-${Date.now()}`,
        qrCodeUrl: status.qrCodeUrl,
      });
    });

    // 检查登录状态
    this.app.post('/v1/getIPadLoginInfo', (req, res) => {
      const status = this.client.getStatus();
      res.json({
        status: status.isLoggedIn ? 'logged_in' : 'waiting',
        wcId: status.wcId,
        nickName: status.nickName,
        headUrl: '',
      });
    });

    // 发送文本消息
    this.app.post('/v1/sendText', async (req, res) => {
      try {
        const { wcId, content } = req.body;
        const result = await this.client.sendText(wcId, content);
        res.json({
          code: '1000',
          data: result,
        });
      } catch (err: any) {
        res.status(500).json({
          code: '500',
          message: err.message,
        });
      }
    });

    // 发送图片消息
    this.app.post('/v1/sendImage2', async (req, res) => {
      try {
        const { wcId, imageUrl } = req.body;
        const result = await this.client.sendImage(wcId, imageUrl);
        res.json({
          code: '1000',
          data: result,
        });
      } catch (err: any) {
        res.status(500).json({
          code: '500',
          message: err.message,
        });
      }
    });

    // 获取通讯录
    this.app.post('/v1/getAddressList', async (req, res) => {
      try {
        const contacts = await this.client.getContacts();
        res.json({
          code: '1000',
          data: contacts,
        });
      } catch (err: any) {
        res.status(500).json({
          code: '500',
          message: err.message,
        });
      }
    });

    // 注册 Webhook
    this.app.post('/v1/webhook/register', (req, res) => {
      this.webhookUrl = req.body.webhookUrl;
      console.log(`Webhook registered: ${this.webhookUrl}`);
      res.json({ success: true, webhookUrl: this.webhookUrl });
    });

    // 获取当前 Webhook 配置
    this.app.get('/v1/webhook', (req, res) => {
      res.json({
        registered: !!this.webhookUrl,
        webhookUrl: this.webhookUrl || null,
      });
    });

    // 测试消息发送（仅用于开发测试）
    this.app.post('/v1/test/send-message', async (req, res) => {
      try {
        const { content, isGroup = false, withMention = false } = req.body;
        
        // 构建测试消息
        const testMessage: MessagePayload = {
          id: `test-${Date.now()}`,
          type: 'text',
          sender: {
            id: 'wxid_test_sender',
            name: 'Test User',
          },
          recipient: {
            id: this.client.getStatus().wcId || 'bot',
          },
          content: content || 'Test message',
          timestamp: Date.now(),
          ...(isGroup && {
            group: {
              id: 'test-group@chatroom',
              name: 'Test Group',
            },
            isMentioned: withMention,
            mention: withMention ? ['bot'] : undefined,
          }),
          raw: {},
        };

        // 触发 webhook
        if (this.webhookUrl) {
          await this.sendWebhookWithRetry(testMessage, 1);
          res.json({
            success: true,
            message: 'Test message sent via webhook',
            webhookUrl: this.webhookUrl,
            messageData: this.convertToWebhookFormat(testMessage),
          });
        } else {
          res.status(400).json({
            success: false,
            error: 'Webhook not registered',
          });
        }
      } catch (err: any) {
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });
  }

  private setupEventHandlers(): void {
    this.client.on('message', async (message: MessagePayload) => {
      if (this.webhookUrl) {
        try {
          await this.sendWebhookWithRetry(message);
        } catch (err) {
          console.error('Failed to send webhook after retries:', err);
        }
      }
    });

    this.client.on('login', (data: { wcId: string; nickName: string }) => {
      console.log(`Bridge: User logged in - ${data.nickName} (${data.wcId})`);
    });

    this.client.on('logout', () => {
      console.log('Bridge: User logged out');
    });

    this.client.on('error', (error: Error) => {
      console.error('Bridge: Client error:', error);
    });
  }

  private async sendWebhookWithRetry(message: MessagePayload, maxRetries: number = 3): Promise<void> {
    const payload = this.convertToWebhookFormat(message);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Webhook-Attempt': String(attempt),
          },
          body: JSON.stringify(payload),
        });
        
        if (response.ok) {
          console.log(`Webhook sent successfully: ${message.id} (attempt ${attempt})`);
          return;
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (err: any) {
        console.error(`Webhook attempt ${attempt} failed:`, err.message);
        
        if (attempt === maxRetries) {
          throw new Error(`Failed after ${maxRetries} attempts: ${err.message}`);
        }
        
        // 指数退避重试
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private convertToWebhookFormat(message: MessagePayload) {
    const isGroup = !!message.group;
    const messageType = isGroup ? '80001' : '60001';

    return {
      messageType,
      wcId: message.recipient.id,
      fromUser: message.sender.id,
      fromGroup: message.group?.id,
      content: message.content,
      newMsgId: message.id,
      timestamp: message.timestamp,
      // 群聊相关字段
      ...(isGroup && {
        groupName: message.group?.name,
        isMentioned: message.isMentioned,
        mentionList: message.mention,
      }),
      // 消息元数据
      meta: {
        type: message.type,
        senderName: message.sender.name,
      },
    };
  }

  async start(): Promise<void> {
    // Start HTTP server first
    const serverPromise = new Promise<void>((resolve) => {
      this.app.listen(this.config.server.port, this.config.server.host, () => {
        console.log(`Bridge server listening on ${this.config.server.host}:${this.config.server.port}`);
        resolve();
      });
    });
    
    await serverPromise;
    
    // Start Wechaty client in background (don't block)
    this.client.start().catch((err) => {
      console.error('Wechaty client failed to start:', err);
    });
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }
}

// 启动服务器（如果直接运行此文件）
if (import.meta.url === `file://${process.argv[1]}`) {
  const config: BridgeConfig = {
    server: {
      port: parseInt(process.env.PORT || '3001'),
      host: process.env.HOST || '0.0.0.0',
    },
    wechaty: {
      name: process.env.WECHATY_NAME || 'openclaw-wechat',
      puppet: process.env.WECHATY_PUPPET || 'wechaty-puppet-wechat',
      puppetToken: process.env.WECHATY_PUPPET_TOKEN,
    },
  };

  const server = new BridgeServer(config);
  
  server.start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });
}
