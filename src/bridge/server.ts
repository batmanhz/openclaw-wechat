import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WechatyClient, MessagePayload } from './wechaty-client.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOK_CONFIG_FILE = path.resolve(__dirname, '../../data/webhook.json');

export interface BridgeConfig {
  server: {
    port: number;
    host: string;
  };
  wechaty: {
    name?: string;
    puppet?: string;
    puppetToken?: string;
    memoryCardPath?: string;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    heartbeatInterval?: number;
  };
}

export class BridgeServer {
  private app: express.Application;
  private client: WechatyClient;
  private config: BridgeConfig;
  private webhookUrl: string = '';
  private scanNotifyEnabled: boolean;
  private scanNotifyPhone: string;
  private lastScanNotifyTime: number = 0;
  private scanNotifyCooldown: number = 60000; // 1分钟冷却，避免重复通知

  constructor(config: BridgeConfig) {
    this.config = config;
    this.app = express();
    this.client = new WechatyClient(config.wechaty);
    this.scanNotifyEnabled = process.env.SCAN_NOTIFY_ENABLED === 'true';
    this.scanNotifyPhone = process.env.SCAN_NOTIFY_PHONE || '';
    this.setupMiddleware();
    this.setupRoutes();
    this.setupEventHandlers();
    this.loadWebhookUrl();
  }

  private loadWebhookUrl(): void {
    try {
      if (fs.existsSync(WEBHOOK_CONFIG_FILE)) {
        const data = JSON.parse(fs.readFileSync(WEBHOOK_CONFIG_FILE, 'utf-8'));
        if (data.webhookUrl) {
          this.webhookUrl = data.webhookUrl;
          logger.info(`Restored webhook URL from config: ${this.webhookUrl}`);
        }
      }
    } catch (error) {
      logger.warn('Failed to load webhook config:', error);
    }
  }

  private saveWebhookUrl(): void {
    try {
      const dataDir = path.dirname(WEBHOOK_CONFIG_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(
        WEBHOOK_CONFIG_FILE,
        JSON.stringify({ webhookUrl: this.webhookUrl }, null, 2)
      );
      logger.info(`Saved webhook URL to config: ${this.webhookUrl}`);
    } catch (error) {
      logger.error('Failed to save webhook config:', error);
    }
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      const start = Date.now();

      logger.debug(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.on('finish', () => {
        const duration = Date.now() - start;
        metrics.recordResponseTime(duration);

        logger.debug(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`, {
          statusCode: res.statusCode,
          duration,
        });
      });

      next();
    });
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (req, res) => {
      const status = this.client.getStatus();
      res.json({
        status: 'ok',
        timestamp: Date.now(),
        wechaty: status.isLoggedIn ? 'ready' : 'pending_login',
        loggedIn: status.isLoggedIn,
      });
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

    // 强制退出登录（清除会话，可用于换账号登录）
    this.app.post('/v1/logout', async (req, res) => {
      try {
        await this.client.logout();
        res.json({
          code: '1000',
          message: 'Logged out successfully, you can now scan QR code with a new account',
        });
      } catch (err: any) {
        res.status(500).json({
          code: '500',
          message: err.message,
        });
      }
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

    // 获取通讯录（详细列表）
    this.app.post('/v1/getAddressList', async (req, res) => {
      try {
        const { forceRefresh = false, includeMembers = false } = req.body;
        const addressList = await this.client.getAddressList(forceRefresh);

        // 如果请求包含群成员详情
        let result: any = { ...addressList };
        if (includeMembers) {
          result.roomMembers = {};
          for (const room of addressList.chatrooms) {
            try {
              result.roomMembers[room.id] = await this.client.getRoomMembers(room.id);
            } catch (e) {
              console.warn(`Failed to get members for room ${room.id}:`, (e as Error).message);
              result.roomMembers[room.id] = [];
            }
          }
        }

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

    // 获取群成员列表
    this.app.post('/v1/getRoomMembers', async (req, res) => {
      try {
        const { roomId } = req.body;
        if (!roomId) {
          res.status(400).json({
            code: '400',
            message: 'roomId is required',
          });
          return;
        }

        const members = await this.client.getRoomMembers(roomId);
        res.json({
          code: '1000',
          data: {
            roomId,
            members,
          },
        });
      } catch (err: any) {
        res.status(500).json({
          code: '500',
          message: err.message,
        });
      }
    });

    // 清除联系人缓存
    this.app.post('/v1/contacts/clearCache', (req, res) => {
      this.client.clearContactsCache();
      res.json({
        code: '1000',
        message: 'Contacts cache cleared successfully',
      });
    });

    // 注册 Webhook
    this.app.post('/v1/webhook/register', (req, res) => {
      this.webhookUrl = req.body.webhookUrl;
      console.log(`Webhook registered: ${this.webhookUrl}`);
      this.saveWebhookUrl();
      res.json({ success: true, webhookUrl: this.webhookUrl });
    });

    // 获取当前 Webhook 配置
    this.app.get('/v1/webhook', (req, res) => {
      res.json({
        registered: !!this.webhookUrl,
        webhookUrl: this.webhookUrl || null,
      });
    });

    // 获取重连状态
    this.app.get('/v1/reconnect/status', (req, res) => {
      const status = this.client.getReconnectStatus();
      res.json({
        code: '1000',
        data: status,
      });
    });

    // 获取心跳状态
    this.app.get('/v1/heartbeat/status', (req, res) => {
      const status = this.client.getHeartbeatStatus();
      res.json({
        code: '1000',
        data: status,
      });
    });

    // 获取监控指标
    this.app.get('/v1/metrics', (req, res) => {
      const snapshot = metrics.getSnapshot();
      res.json({
        code: '1000',
        data: snapshot,
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
      metrics.recordMessageReceived();

      // Log the message for debugging
      const msgType = message.group ? 'group' : 'private';
      const sender = message.sender.name || message.sender.id;
      const content = message.content.substring(0, 100);
      logger.info(
        `📨 Message received: ${message.type} from ${sender} in ${msgType}: "${content}"`
      );

      if (this.webhookUrl) {
        try {
          await this.sendWebhookWithRetry(message);
        } catch (err) {
          logger.error('Failed to send webhook after retries', err);
        }
      } else {
        logger.warn(`⚠️ Webhook not configured, message not forwarded to OpenClaw`);
      }
    });

    this.client.on('login', (data: { wcId: string; nickName: string }) => {
      metrics.setConnectionStatus('connected');
      logger.info(`User logged in - ${data.nickName} (${data.wcId})`);
    });

    this.client.on('logout', () => {
      metrics.setConnectionStatus('disconnected');
      logger.info('User logged out');
    });

    this.client.on('error', (error: Error) => {
      logger.error('Client error', error);
    });

    // 重连相关事件
    this.client.on(
      'reconnecting',
      (data: { attempt: number; maxAttempts: number; delay: number }) => {
        metrics.setConnectionStatus('reconnecting');
        metrics.recordReconnectAttempt();
        logger.warn(
          `Reconnecting... Attempt ${data.attempt}/${data.maxAttempts} in ${Math.round(data.delay / 1000)}s`
        );
      }
    );

    this.client.on('reconnected', () => {
      metrics.setConnectionStatus('connected');
      logger.info('Reconnected successfully!');
    });

    this.client.on('reconnectFailed', (data: { attempt: number; error: string }) => {
      logger.error(`Reconnect attempt ${data.attempt} failed`, new Error(data.error));
    });

    this.client.on('reconnectExhausted', (data: { maxAttempts: number }) => {
      logger.error(`Reconnect exhausted after ${data.maxAttempts} attempts`);
    });

    // 心跳相关事件
    this.client.on('heartbeat', (data: { status: string; timestamp: number }) => {
      logger.debug(`Heartbeat OK at ${new Date(data.timestamp).toISOString()}`);
    });

    this.client.on('heartbeatFailed', (data: { missedCount: number }) => {
      logger.error(`Heartbeat failed, missed ${data.missedCount} times`);
    });

    // 登录失效事件 - 发送扫码通知
    this.client.on('loginExpired', (data: { reason: string }) => {
      logger.warn(`Login expired: ${data.reason}`);
      metrics.setConnectionStatus('disconnected');
    });

    // 扫码事件 - 发送扫码通知（首次扫码时）
    this.client.on('scan', async (qrCodeUrl: string, sessionId: string) => {
      logger.info(`QR Code generated: ${qrCodeUrl}`);
      
      // 发送扫码通知
      await this.sendScanNotification(qrCodeUrl, '微信需要扫码登录');
    });

    // 注册告警处理
    metrics.onAlert((type, message, data) => {
      logger.warn(`Alert triggered: ${type}`, { message, ...data });
    });
  }

  private async sendWebhookWithRetry(
    message: MessagePayload,
    maxRetries: number = 3
  ): Promise<void> {
    const payload = this.convertToWebhookFormat(message);
    const startTime = Date.now();

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
          const latency = Date.now() - startTime;
          metrics.recordWebhookSent(latency);
          logger.debug(
            `Webhook sent successfully: ${message.id} (attempt ${attempt}, ${latency}ms)`
          );
          return;
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (err: any) {
        logger.warn(`Webhook attempt ${attempt} failed`, {
          error: err.message,
          messageId: message.id,
        });

        if (attempt === maxRetries) {
          metrics.recordWebhookFailed(err);
          throw new Error(`Failed after ${maxRetries} attempts: ${err.message}`);
        }

        // 指数退避重试
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private convertToWebhookFormat(message: MessagePayload) {
    const isGroup = !!message.group;
    const isImage = message.type === 'image';
    
    // messageType: 60001=私聊文本, 60002=私聊图片, 80001=群聊文本, 80002=群聊图片
    let messageType: string;
    if (isGroup) {
      messageType = isImage ? '80002' : '80001';
    } else {
      messageType = isImage ? '60002' : '60001';
    }

    const result: any = {
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

    // 图片消息
    if (message.imageUrl) {
      result.imageUrl = message.imageUrl;
    }

    return result;
  }

  /**
   * 发送扫码通知到 OpenClaw，请求通过 WhatsApp 转发
   */
  private async sendScanNotification(qrCodeUrl: string, reason: string): Promise<void> {
    logger.info(`[Scan Notify] Checking conditions...`, {
      enabled: this.scanNotifyEnabled,
      hasPhone: !!this.scanNotifyPhone,
      hasWebhook: !!this.webhookUrl,
      lastNotifyTime: this.lastScanNotifyTime,
      cooldownMs: this.scanNotifyCooldown,
    });

    if (!this.scanNotifyEnabled || !this.scanNotifyPhone || !this.webhookUrl) {
      logger.info('[Scan Notify] Skipped: missing configuration');
      return;
    }

    // 冷却检查，避免频繁通知
    const now = Date.now();
    const timeSinceLastNotify = now - this.lastScanNotifyTime;
    if (timeSinceLastNotify < this.scanNotifyCooldown) {
      logger.info(`[Scan Notify] Skipped: cooldown (${Math.round(timeSinceLastNotify / 1000)}s < ${this.scanNotifyCooldown / 1000}s)`);
      return;
    }
    this.lastScanNotifyTime = now;

    logger.info(`[Scan Notify] Sending notification to ${this.scanNotifyPhone}...`);

    // 构造通知消息，让 AI 理解意图并通过 WhatsApp 发送
    const notifyMessage: MessagePayload = {
      id: `scan-notify-${Date.now()}`,
      type: 'text',
      sender: { id: 'system', name: 'WeChat Bridge System' },
      recipient: { id: 'openclaw' },
      content: `[系统通知] 微信需要重新扫码登录。

原因：${reason}

请通过 WhatsApp 发送以下扫码链接给 ${this.scanNotifyPhone}：

${qrCodeUrl}

这是一个紧急通知，请立即执行。`,
      timestamp: Date.now(),
      raw: {
        _meta: {
          type: 'system_notification',
          notificationType: 'wechat_scan_required',
          targetPhone: this.scanNotifyPhone,
          qrCodeUrl: qrCodeUrl,
          reason: reason,
        },
      },
    };

    try {
      await this.sendWebhookWithRetry(notifyMessage, 1);
      logger.info(`📱 Scan notification sent to OpenClaw for WhatsApp delivery to ${this.scanNotifyPhone}`);
    } catch (err) {
      logger.error('Failed to send scan notification', err);
    }
  }

  async start(): Promise<void> {
    logger.info('Starting Bridge server...', {
      host: this.config.server.host,
      port: this.config.server.port,
    });

    // Start HTTP server first
    const serverPromise = new Promise<void>((resolve) => {
      this.app.listen(this.config.server.port, this.config.server.host, () => {
        logger.info(
          `Bridge server listening on ${this.config.server.host}:${this.config.server.port}`
        );
        resolve();
      });
    });

    await serverPromise;

    // Auto-register webhook if configured
    const webhookPort = parseInt(process.env.WEBHOOK_PORT || '18790');
    const webhookPath = process.env.WEBHOOK_PATH || '/webhook/wechat';
    const webhookHost = process.env.WEBHOOK_HOST || 'localhost';

    // Check if we should auto-register webhook
    if (process.env.AUTO_REGISTER_WEBHOOK === 'true') {
      const webhookUrl = `http://${webhookHost}:${webhookPort}${webhookPath}`;
      logger.info(`Auto-registering webhook: ${webhookUrl}`);
      this.webhookUrl = webhookUrl;
      this.saveWebhookUrl();
    }

    // Start Wechaty client in background (don't block)
    this.client.start().catch((err) => {
      logger.error('Wechaty client failed to start', err);
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopping Bridge server...');
    await this.client.stop();
    logger.info('Bridge server stopped');
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
      puppet: process.env.WECHATY_PUPPET || 'wechaty-puppet-wechat4u',
      puppetToken: process.env.WECHATY_PUPPET_TOKEN,
      memoryCardPath: process.env.WECHATY_MEMORY_CARD_PATH || './data',
      reconnectInterval: parseInt(process.env.WECHATY_RECONNECT_INTERVAL || '5000'),
      maxReconnectAttempts: parseInt(process.env.WECHATY_MAX_RECONNECT_ATTEMPTS || '10'),
      heartbeatInterval: parseInt(process.env.WECHATY_HEARTBEAT_INTERVAL || '30000'),
    },
  };

  const server = new BridgeServer(config);

  server.start().catch((err) => {
    logger.error('Failed to start server', err);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });
}
