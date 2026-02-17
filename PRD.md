# OpenClaw WeChat Integration PRD
## 基于 Wechaty 框架的微信对接方案

**版本**: 1.0  
**日期**: 2026-02-16  
**作者**: AI Assistant  
**状态**: 草案  

---

## 1. 项目概述

### 1.1 项目背景
当前 OpenClaw 的微信插件依赖于第三方商业服务"苍何服务云"，需要通过 API Key 进行身份验证和计费。为了实现私有化部署、降低成本并提高数据安全性，本项目将基于开源框架 Wechaty 重构微信对接能力。

### 1.2 项目目标
- 移除对"苍何服务云"的依赖
- 实现完全本地化的微信机器人部署
- 保持与现有 OpenClaw 插件架构的兼容性
- 支持私聊和群聊消息收发
- 支持文本和图片消息
- 提供二维码登录流程

### 1.3 目标用户
- 需要私有化部署的企业用户
- 对数据安全有严格要求的组织
- 希望降低运营成本的开发者

---

## 2. 技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenClaw Core                          │
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │  Channel Router │  │      WeChat Plugin (本改造)      │   │
│  └────────┬────────┘  └──────────────────┬──────────────┘   │
│           │                              │                   │
│           │  1. dispatch message         │  2. handle msg   │
│           │                              │                   │
└───────────┼──────────────────────────────┼───────────────────┘
            │                              │
            │                              │ HTTP/WebSocket
            ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Wechaty Bridge Service                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Wechaty Core Framework                    │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │         Puppet Implementation                    │  │ │
│  │  │  (wechaty-puppet-padlocal/wechaty-puppet-wechat) │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ 微信协议
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     WeChat Server                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件说明

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| OpenClaw Plugin | TypeScript | 改造现有插件，移除苍何服务云依赖 |
| Wechaty Bridge | Node.js + Wechaty | 中间层服务，对接 Wechaty 和 OpenClaw |
| Puppet Protocol | wechaty-puppet-padlocal / wechaty-puppet-wechat | 微信协议实现 |
| Message Queue | 可选 Redis/Bull | 高并发场景下的消息队列 |

### 2.3 通信协议

- **OpenClaw ↔ Bridge**: HTTP REST API
- **Bridge ↔ Wechaty**: Node.js API 调用
- **Wechaty ↔ 微信**: 私有协议（由 Puppet 处理）

---

## 3. 功能需求

### 3.1 功能清单

#### 3.1.1 登录管理
| 功能 ID | 功能描述 | 优先级 | 状态 |
|---------|----------|--------|------|
| F-001 | 二维码扫码登录 | P0 | 待实现 |
| F-002 | 登录状态保持（热重载） | P1 | 待实现 |
| F-003 | 多账号支持 | P2 | 待实现 |
| F-004 | 自动重连机制 | P1 | 待实现 |

#### 3.1.2 消息收发
| 功能 ID | 功能描述 | 优先级 | 状态 |
|---------|----------|--------|------|
| F-101 | 接收文本消息 | P0 | 待实现 |
| F-102 | 发送文本消息 | P0 | 待实现 |
| F-103 | 接收图片消息 | P1 | 待实现 |
| F-104 | 发送图片消息 | P1 | 待实现 |
| F-105 | 接收@提及消息 | P1 | 待实现 |
| F-106 | 群聊消息处理 | P0 | 待实现 |

#### 3.1.3 联系人管理
| 功能 ID | 功能描述 | 优先级 | 状态 |
|---------|----------|--------|------|
| F-201 | 获取好友列表 | P2 | 待实现 |
| F-202 | 获取群列表 | P2 | 待实现 |
| F-203 | 获取群成员列表 | P3 | 待实现 |

#### 3.1.4 系统功能
| 功能 ID | 功能描述 | 优先级 | 状态 |
|---------|----------|--------|------|
| F-301 | 心跳检测 | P1 | 待实现 |
| F-302 | 日志记录 | P1 | 待实现 |
| F-303 | 配置热更新 | P2 | 待实现 |

---

### 3.2 非功能需求

#### 3.2.1 性能需求
- 消息接收延迟 < 500ms
- 消息发送延迟 < 1s
- 支持并发处理 50 个群的消息
- 单账号日消息处理量 > 10,000 条

#### 3.2.2 可靠性需求
- 服务可用性 > 99%
- 消息不丢失（本地持久化）
- 异常自动恢复

#### 3.2.3 安全需求
- 微信登录信息本地加密存储
- 敏感配置项环境变量注入
- 消息内容本地处理，不上传第三方

---

## 4. 系统设计

### 4.1 项目结构

```
openclaw-wechat-wechaty/
├── src/
│   ├── plugin/                    # OpenClaw 插件代码
│   │   ├── index.ts              # 插件入口
│   │   ├── channel.ts            # 频道主逻辑
│   │   ├── config-schema.ts      # 配置定义
│   │   ├── types.ts              # 类型定义
│   │   ├── bot.ts                # 消息处理
│   │   ├── reply-dispatcher.ts   # 回复分发
│   │   └── runtime.ts            # 运行时管理
│   ├── bridge/                    # Wechaty Bridge 服务
│   │   ├── server.ts             # HTTP 服务入口
│   │   ├── wechaty-client.ts     # Wechaty 封装
│   │   ├── message-handler.ts    # 消息处理器
│   │   ├── api-routes.ts         # API 路由定义
│   │   └── auth-manager.ts       # 登录状态管理
│   └── shared/                    # 共享代码
│       ├── constants.ts          # 常量定义
│       └── utils.ts              # 工具函数
├── config/
│   └── wechaty-config.yaml       # Bridge 服务配置
├── scripts/
│   ├── start-bridge.sh           # 启动脚本
│   └── setup.sh                  # 安装脚本
├── tests/                         # 测试代码
├── docs/                          # 文档
├── package.json
├── tsconfig.json
└── README.md
```

### 4.2 核心类图

```
┌──────────────────────────────┐
│     WechatyBridgeServer      │
├──────────────────────────────┤
│ - app: Express               │
│ - wechatyClient: WechatyClient│
│ - port: number               │
├──────────────────────────────┤
│ + start(): Promise<void>     │
│ + stop(): Promise<void>      │
│ + getStatus(): ServerStatus  │
└──────────────┬───────────────┘
               │
               │ uses
               ▼
┌──────────────────────────────┐
│      WechatyClient           │
├──────────────────────────────┤
│ - bot: Wechaty               │
│ - isLoggedIn: boolean        │
│ - qrCodeUrl: string          │
│ - wcId: string               │
├──────────────────────────────┤
│ + start(): Promise<void>     │
│ + stop(): Promise<void>      │
│ + sendText(to, content): Promise<MsgResult>   │
│ + sendImage(to, url): Promise<MsgResult>      │
│ + getContacts(): Promise<Contact[]>           │
│ + onMessage(callback): void  │
└──────────────────────────────┘
```

### 4.3 流程设计

#### 4.3.1 启动流程

```
┌──────────────┐
│  用户启动    │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ 1. 加载配置      │
│    - 读取        │
│    ~/.openclaw/  │
│    openclaw.json │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ 2. 启动 Bridge   │
│    服务          │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ 3. Wechaty       │
│    初始化        │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐     已登录      ┌──────────────┐
│ 4. 检查登录状态  │ ───────────────▶│ 6. 注册      │
└──────┬───────────┘                 │    Webhook   │
       │ 未登录                      └──────────────┘
       ▼
┌──────────────────┐
│ 5. 显示二维码    │
│    等待扫码      │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ 5.1 扫码成功     │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ 6. 注册 Webhook  │
│    (本地回调地址)│
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ 7. 启动完成      │
│    等待消息      │
└──────────────────┘
```

#### 4.3.2 消息接收流程

```
┌─────────────────┐
│ 微信用户发送消息 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 微信服务器       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Wechaty         │
│ Puppet          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ WechatyClient   │
│ onMessage       │
│ 回调触发        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Bridge Server   │
│ POST /webhook   │
│ /wechat         │
│ (发送到本地     │
│ OpenClaw)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ OpenClaw Plugin │
│ callback-server │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ bot.ts          │
│ handleWeChatMsg │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 路由到 Agent     │
│ 处理回复         │
└─────────────────┘
```

#### 4.3.3 消息发送流程

```
┌─────────────────┐
│ Agent 生成回复   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ OpenClaw Plugin │
│ outbound.sendXXX│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Bridge Server   │
│ API 调用        │
│ /v1/sendText    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ WechatyClient   │
│ sendText()      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Wechaty Puppet  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 微信服务器       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 用户收到消息     │
└─────────────────┘
```

---

## 5. 接口设计

### 5.1 Bridge HTTP API

#### 5.1.1 账号状态
```http
GET /v1/account/status

Response:
{
  "valid": true,
  "isLoggedIn": true,
  "wcId": "wxid_xxxxxxxx",
  "nickName": "用户昵称",
  "error": null
}
```

#### 5.1.2 获取登录二维码
```http
POST /v1/iPadLogin

Request:
{
  "deviceType": "mac",  // "mac" | "ipad"
  "proxy": "10"         // 可选
}

Response:
{
  "wId": "login-session-id",
  "qrCodeUrl": "https://wechaty.js.org/qrcode/..."
}
```

#### 5.1.3 检查登录状态
```http
POST /v1/getIPadLoginInfo

Request:
{
  "wId": "login-session-id"
}

Response:
{
  "status": "logged_in",  // "waiting" | "need_verify" | "logged_in"
  "wcId": "wxid_xxxxxxxx",
  "nickName": "用户昵称",
  "headUrl": "https://..."
}
```

#### 5.1.4 发送文本消息
```http
POST /v1/sendText

Request:
{
  "wcId": "wxid_xxxxxxxx",
  "content": "消息内容"
}

Response:
{
  "msgId": 123456,
  "newMsgId": 789012,
  "createTime": 1700000000
}
```

#### 5.1.5 发送图片消息
```http
POST /v1/sendImage2

Request:
{
  "wcId": "wxid_xxxxxxxx",
  "imageUrl": "https://example.com/image.jpg"
}

Response:
{
  "msgId": 123456,
  "newMsgId": 789012,
  "createTime": 1700000000
}
```

#### 5.1.6 获取通讯录
```http
POST /v1/getAddressList

Request:
{
  "wcId": "wxid_xxxxxxxx"
}

Response:
{
  "friends": ["wxid_xxx", "wxid_yyy"],
  "chatrooms": ["1234567890@chatroom"]
}
```

#### 5.1.7 注册 Webhook
```http
POST /v1/webhook/register

Request:
{
  "webhookUrl": "http://localhost:18790/webhook/wechat"
}

Response:
{
  "success": true
}
```

### 5.2 Webhook 消息格式

Bridge 向 OpenClaw 推送的消息格式：

```typescript
interface WebhookMessage {
  messageType: string;      // "60001" 私聊文本, "80001" 群聊文本
  wcId: string;            // 当前登录用户ID
  fromUser: string;        // 发送者ID
  toUser: string;          // 接收者ID
  fromGroup?: string;      // 群ID（群聊时）
  content: string;         // 消息内容
  newMsgId: string;        // 消息ID
  timestamp: number;       // 时间戳
  contentType?: string;    // 内容类型
  raw: any;               // 原始数据
}
```

---

## 6. 配置设计

### 6.1 OpenClaw 配置 (~/.openclaw/openclaw.json)

```json
{
  "channels": {
    "wechat": {
      "enabled": true,
      "provider": "wechaty",
      
      "bridgeUrl": "http://localhost:3001",
      "webhookHost": "localhost",
      "webhookPort": 18790,
      "webhookPath": "/webhook/wechat",
      
      "puppet": "wechaty-puppet-wechat",
      "puppetToken": "",
      
      "deviceType": "mac",
      "autoLogin": true,
      "sessionFile": "./wechaty-session.memory-card.json"
    }
  }
}
```

### 6.2 Bridge 服务配置 (config/wechaty-config.yaml)

```yaml
server:
  port: 3001
  host: "0.0.0.0"

wechaty:
  name: "openclaw-wechat-bridge"
  puppet: "wechaty-puppet-wechat"
  # puppet: "wechaty-puppet-padlocal"
  # puppetToken: "your-padlocal-token"
  
  # 会话保持
  session:
    enabled: true
    file: "./wechaty-session.json"
  
  # 重连配置
  retry:
    maxAttempts: 5
    delayMs: 5000

webhook:
  enabled: true
  url: "http://localhost:18790/webhook/wechat"
  retryAttempts: 3

logging:
  level: "info"
  file: "./logs/wechaty-bridge.log"
  maxSize: "10m"
  maxFiles: 5
```

---

## 7. 实施计划

### 7.1 阶段划分

#### 阶段一：基础框架 (Week 1-2)
- [ ] 创建项目结构和基础配置
- [ ] 实现 WechatyClient 核心类
- [ ] 实现 Bridge HTTP Server
- [ ] 实现基础 API 接口

#### 阶段二：消息收发 (Week 3-4)
- [ ] 实现消息接收和 webhook 推送
- [ ] 实现文本消息发送
- [ ] 实现图片消息收发
- [ ] 实现群聊消息处理

#### 阶段三：OpenClaw 集成 (Week 5-6)
- [ ] 改造现有插件代码
- [ ] 实现配置适配
- [ ] 集成测试
- [ ] 编写文档

#### 阶段四：优化和发布 (Week 7-8)
- [ ] 性能优化
- [ ] 错误处理和日志完善
- [ ] 编写使用文档
- [ ] 发布到 npm

### 7.2 任务清单

| 任务 | 负责人 | 截止日期 | 状态 |
|------|--------|----------|------|
| 项目初始化 | - | Week 1 | ⬜ |
| WechatyClient 开发 | - | Week 2 | ⬜ |
| Bridge Server 开发 | - | Week 2 | ⬜ |
| 消息接收实现 | - | Week 3 | ⬜ |
| 消息发送实现 | - | Week 4 | ⬜ |
| OpenClaw 插件改造 | - | Week 5 | ⬜ |
| 集成测试 | - | Week 6 | ⬜ |
| 文档编写 | - | Week 7 | ⬜ |
| 发布准备 | - | Week 8 | ⬜ |

---

## 8. 技术实现细节

### 8.1 WechatyClient 核心代码

```typescript
// src/bridge/wechaty-client.ts
import { WechatyBuilder, Contact, Room, Message } from 'wechaty';
import { EventEmitter } from 'events';

export interface MessagePayload {
  id: string;
  type: 'text' | 'image' | 'file' | 'unknown';
  sender: { id: string; name: string };
  recipient: { id: string };
  content: string;
  timestamp: number;
  group?: { id: string; name: string };
  raw: any;
}

export class WechatyClient extends EventEmitter {
  private bot: any;
  private config: any;
  private isLoggedIn: boolean = false;
  private wcId: string = '';
  private nickName: string = '';
  private qrCodeUrl: string = '';
  private loginSessionId: string = '';

  constructor(config: any) {
    super();
    this.config = config;
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
    const contact = message.talker();
    const room = message.room();
    const type = message.type();

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

    if (room) {
      payload.group = {
        id: room.id,
        name: await room.topic() || room.id,
      };
    }

    this.emit('message', payload);
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

    // 下载图片并发送的逻辑
    // ...
    
    return {
      msgId: Date.now(),
      newMsgId: Date.now(),
      createTime: Date.now(),
    };
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
```

### 8.2 Bridge Server 实现

```typescript
// src/bridge/server.ts
import express from 'express';
import { WechatyClient } from './wechaty-client';
import { createLogger } from './utils/logger';

export class BridgeServer {
  private app: express.Application;
  private client: WechatyClient;
  private config: any;
  private logger: any;
  private webhookUrl: string = '';

  constructor(config: any) {
    this.config = config;
    this.app = express();
    this.logger = createLogger(config.logging);
    this.client = new WechatyClient(config.wechaty);
    this.setupMiddleware();
    this.setupRoutes();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      this.logger.info(`${req.method} ${req.path}`);
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
      });
    });

    // 获取二维码
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
      });
    });

    // 发送文本
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

    // 发送图片
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
      this.logger.info(`Webhook registered: ${this.webhookUrl}`);
      res.json({ success: true });
    });
  }

  private setupEventHandlers(): void {
    this.client.on('message', async (message) => {
      if (this.webhookUrl) {
        try {
          await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.convertToWebhookFormat(message)),
          });
        } catch (err) {
          this.logger.error('Failed to send webhook:', err);
        }
      }
    });
  }

  private convertToWebhookFormat(message: any) {
    const isGroup = !!message.group;
    const messageType = isGroup ? '80001' : '60001';

    return {
      messageType,
      wcId: message.recipient.id,
      fromUser: message.sender.id,
      toUser: message.recipient.id,
      fromGroup: message.group?.id,
      content: message.content,
      newMsgId: message.id,
      timestamp: message.timestamp,
      raw: message.raw,
    };
  }

  async start(): Promise<void> {
    await this.client.start();
    
    return new Promise((resolve) => {
      this.app.listen(this.config.server.port, () => {
        this.logger.info(`Bridge server listening on port ${this.config.server.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }
}
```

### 8.3 OpenClaw 插件改造

修改 `src/channel.ts` 中的配置解析逻辑：

```typescript
// 修改 resolveWeChatAccount 函数
async function resolveWeChatAccount({
  cfg,
  accountId,
}: {
  cfg: ClawdbotConfig;
  accountId: string;
}): Promise<ResolvedWeChatAccount> {
  const wechatCfg = cfg.channels?.wechat as WechatConfig | undefined;
  
  // 移除 API Key 强制检查
  // if (!accountCfg?.apiKey) { ... }

  // 移除 proxyUrl 强制检查，改用 bridgeUrl
  if (!accountCfg?.bridgeUrl) {
    throw new Error(
      `缺少 bridgeUrl 配置。\n` +
        `请配置: openclaw config set channels.wechat.bridgeUrl "http://localhost:3001"`
    );
  }

  return {
    // ... 其他字段
    bridgeUrl: accountCfg.bridgeUrl,
    // 移除 apiKey 和 proxyUrl
  };
}
```

---

## 9. 部署指南

### 9.1 环境准备

```bash
# 系统要求
- Node.js >= 18
- npm >= 8
- 微信账号（建议用小号测试）

# 安装依赖
npm install wechaty wechaty-puppet-wechat express
npm install -D typescript @types/express @types/node
```

### 9.2 安装步骤

1. **克隆仓库**
```bash
git clone https://github.com/your-org/openclaw-wechat-wechaty.git
cd openclaw-wechat-wechaty
```

2. **安装依赖**
```bash
npm install
```

3. **编译 TypeScript**
```bash
npm run build
```

4. **配置 Bridge 服务**
```bash
cp config/wechaty-config.example.yaml config/wechaty-config.yaml
# 编辑配置文件
```

5. **启动 Bridge 服务**
```bash
npm run start:bridge
# 或
node dist/bridge/server.js
```

6. **配置 OpenClaw**
```bash
openclaw config set channels.wechat.bridgeUrl "http://localhost:3001"
openclaw config set channels.wechat.enabled true
```

7. **启动 OpenClaw Gateway**
```bash
openclaw gateway start
```

### 9.3 Docker 部署

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY config ./config

EXPOSE 3001 18790

CMD ["node", "dist/bridge/server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  wechaty-bridge:
    build: .
    ports:
      - "3001:3001"
      - "18790:18790"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

---

## 10. 测试方案

### 10.1 单元测试

```typescript
// tests/wechaty-client.test.ts
import { WechatyClient } from '../src/bridge/wechaty-client';

describe('WechatyClient', () => {
  let client: WechatyClient;

  beforeEach(() => {
    client = new WechatyClient({
      name: 'test-bot',
      puppet: 'wechaty-puppet-mock',
    });
  });

  test('should start successfully', async () => {
    await expect(client.start()).resolves.not.toThrow();
  });

  test('should get initial status', () => {
    const status = client.getStatus();
    expect(status.valid).toBe(true);
    expect(status.isLoggedIn).toBe(false);
  });
});
```

### 10.2 集成测试

```bash
# 测试脚本
npm run test:integration

# 测试内容：
# 1. 启动 Bridge 服务
# 2. 模拟扫码登录
# 3. 发送测试消息
# 4. 验证消息接收
# 5. 停止服务
```

### 10.3 E2E 测试

```bash
# 端到端测试
npm run test:e2e

# 测试流程：
# 1. 启动完整服务栈
# 2. 真实微信扫码登录
# 3. 发送/接收消息测试
# 4. 群聊功能测试
# 5. 断开重连测试
```

---

## 11. 风险和对策

### 11.1 技术风险

| 风险 | 影响 | 概率 | 对策 |
|------|------|------|------|
| Wechaty 协议被封 | 高 | 中 | 1. 使用 Puppet 隔离层，便于切换协议<br>2. 关注 Wechaty 社区动态<br>3. 准备备选方案（PadLocal） |
| 微信账号被封 | 高 | 低 | 1. 使用小号测试<br>2. 控制消息频率<br>3. 避免敏感词 |
| 消息丢失 | 中 | 低 | 1. 本地消息持久化<br>2. 消息确认机制<br>3. 重试队列 |
| 内存泄漏 | 中 | 中 | 1. 定期重启机制<br>2. 内存监控<br>3. 性能测试 |

### 11.2 运营风险

| 风险 | 影响 | 概率 | 对策 |
|------|------|------|------|
| 用户操作不当 | 中 | 高 | 1. 完善的错误提示<br>2. 详细的操作文档<br>3. 一键诊断工具 |
| 配置错误 | 中 | 高 | 1. 配置校验<br>2. 默认值优化<br>3. 配置向导 |

---

## 12. 附录

### 12.1 参考文档

- [Wechaty 官方文档](https://wechaty.js.org/)
- [Wechaty Puppet 接口](https://github.com/wechaty/wechaty-puppet)
- [OpenClaw 插件开发指南](https://github.com/openclaw/openclaw/tree/main/docs)
- [微信协议原理](https://github.com/ljc545w/ComWeChatRobot)

### 12.2 术语表

| 术语 | 说明 |
|------|------|
| OpenClaw | AI 机器人框架，支持多频道接入 |
| Wechaty | 开源微信机器人框架 |
| Puppet | Wechaty 的协议实现层 |
| Bridge | 连接 OpenClaw 和 Wechaty 的中间服务 |
| wcId | 微信用户的唯一标识 |
| webhook | 消息回调接口 |

### 12.3 变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0 | 2026-02-16 | 初始版本 | AI Assistant |

---

## 13. 总结

本 PRD 文档详细描述了基于 Wechaty 框架实现 OpenClaw 微信对接的完整方案。通过引入 Bridge 中间层，我们能够：

1. **完全移除对第三方商业服务的依赖**
2. **实现私有化部署和数据安全**
3. **降低长期运营成本**
4. **保持与现有 OpenClaw 架构的兼容性**

该方案的主要优势在于使用成熟的 Wechaty 开源框架，具有良好的社区支持和持续维护。同时通过 Bridge 层的抽象，使得协议层可以轻松替换，降低了技术风险。

**下一步行动**：
1. 评审本 PRD 文档
2. 搭建开发环境
3. 开始阶段一开发（基础框架）
4. 定期同步进展并更新文档

---

**文档结束**
