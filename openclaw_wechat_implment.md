# OpenClaw WeChat 插件实现文档

## 1. 项目概述

本项目是 OpenClaw 的微信渠道插件，基于 Wechaty 框架实现微信消息的收发。采用 Bridge 架构模式，将 Wechaty 微信协议层与 OpenClaw 插件层分离，通过 HTTP API 进行通信。

### 1.1 核心特性

- **私有化部署**：完全本地运行，无需第三方商业服务
- **消息类型支持**：文本、图片、视频、语音、链接
- **群聊支持**：群消息收发、@提及检测
- **断线重连**：指数退避重连机制
- **心跳检测**：自动检测连接状态
- **消息去重**：防止重复处理消息
- **联系人缓存**：带TTL的联系人缓存机制

### 1.2 技术栈

- **核心框架**：Wechaty (wechaty-puppet-wechat4u)
- **服务端**：Express.js + TypeScript
- **通信协议**：HTTP REST API + Webhook
- **构建工具**：TypeScript 5.x + tsx

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Core                            │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐   │
│  │  Channel Router │  │      WeChat Plugin (本插件)         │   │
│  │                 │  │  - channel.ts (渠道主逻辑)           │   │
│  │                 │  │  - bot.ts (消息处理)                 │   │
│  │                 │  │  - reply-dispatcher.ts (回复分发)    │   │
│  └────────┬────────┘  └──────────────────┬──────────────────┘   │
└───────────┼──────────────────────────────┼──────────────────────┘
            │                              │
            │  HTTP API                    │ Webhook (事件推送)
            ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Bridge HTTP Service (3001)                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              WechatyClient                              │    │
│  │  - 微信协议封装                                         │    │
│  │  - 消息类型转换                                         │    │
│  │  - 重连/心跳管理                                        │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ 微信协议 (wechaty-puppet-wechat4u)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     WeChat Server (腾讯)                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 端口用途说明

| 端口 | 协议 | 监听方 | 用途 |
|------|------|--------|------|
| **3001** | HTTP | Bridge | OpenClaw → Bridge 的控制接口（查询状态、发送消息等） |
| **18790** | HTTP | OpenClaw | Bridge → OpenClaw 的消息推送（Webhook 回调） |

**为什么需要两个端口？**
- Bridge 是独立进程，与 OpenClaw 通过 HTTP 通信
- OpenClaw 需要被动接收消息（不能轮询），Webhook 是实时推送的标准做法
- 两个方向独立，避免循环依赖

### 2.3 消息流向详解

**入站消息（微信 → OpenClaw）：**
```
微信用户发送消息
    ↓
微信服务器 (腾讯)
    ↓ (微信私有协议，加密)
Wechaty Puppet (wechaty-puppet-wechat4u)
    ↓ (解析成 JavaScript 对象)
Bridge Server (3001)
    - 消息去重检查
    - 图片/视频处理 (FileBox.toBase64)
    - 格式转换
    ↓ (HTTP POST)
Webhook Server (18790) [OpenClaw Plugin]
    - callback-server.ts 接收请求
    - convertToMessageContext() 格式转换
    ↓
handleWeChatMessage() (bot.ts)
    - 消息路由
    - 传递给对应 Agent
    ↓
LLM Agent 处理
```

**出站消息（OpenClaw → 微信）：**
```
LLM Agent 生成回复
    ↓
outbound.sendText() (channel.ts)
    ↓ (HTTP POST)
Bridge Server (3001) /v1/sendText
    ↓
WechatyClient.sendText()
    - 查找联系人/群
    - target.say(content)
    ↓
微信服务器
    ↓
微信用户
```

### 2.2 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| 插件入口 | `index.ts` | 注册插件到 OpenClaw |
| 渠道配置 | `src/channel.ts` | 账号管理、登录流程、消息路由 |
| 消息处理 | `src/bot.ts` | 入站消息处理、Agent 分发 |
| 回复分发 | `src/reply-dispatcher.ts` | 出站消息发送、分块处理 |
| Bridge客户端 | `src/bridge-client.ts` | 调用 Bridge 3001 端口 API |
| Bridge服务端 | `src/bridge/server.ts` | Express HTTP 服务 (端口 3001) |
| Wechaty封装 | `src/bridge/wechaty-client.ts` | Wechaty 实例管理 |
| 回调服务 | `src/callback-server.ts` | Webhook 接收服务 (端口 18790) |

---

## 3. 核心实现逻辑

### 3.1 启动流程

```
1. OpenClaw Gateway 启动
   └── 加载 openclaw-wechat 插件
       └── 调用 wechatPlugin.gateway.startAccount()
           ├── 解析账号配置 (resolveWeChatAccount)
           │   └── 读取 webhookPort (默认 18790)
           ├── 健康检查 (BridgeClient.healthCheck)
           │   └── GET http://localhost:3001/health
           ├── 如未登录: 获取二维码 -> 轮询登录状态
           │   ├── 显示二维码 (displayQRCode)
           │   ├── 每5秒检查一次，最多60次(5分钟)
           │   └── 登录成功后显示成功信息
           ├── 注册 Webhook (registerWebhook)
           │   └── POST http://localhost:3001/v1/webhook/register
           │       Body: { webhookUrl: "http://localhost:18790/webhook/wechat" }
           ├── 启动回调服务器 (startCallbackServer)
           │   └── 监听 0.0.0.0:18790/webhook/wechat
           │       【等待 Bridge 推送消息到此端口】
           └── 返回 stop 清理函数
```

**启动时的端口依赖关系：**

```
┌─────────────────────────────────────────────────────────────┐
│  启动顺序                                                    │
├─────────────────────────────────────────────────────────────┤
│  1. Bridge 服务必须先运行 (端口 3001)                         │
│     └── 否则 healthCheck() 会失败                            │
│                                                             │
│  2. 微信登录完成后，OpenClaw 启动 webhook 服务器 (端口 18790)  │
│     └── 调用 startCallbackServer()                           │
│                                                             │
│  3. OpenClaw 向 Bridge 注册 webhook URL                     │
│     └── POST /v1/webhook/register                            │
│                                                             │
│  4. Bridge 收到微信消息后，推送到 18790                       │
│     └── POST http://localhost:18790/webhook/wechat           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 消息接收流程（入站）

**路径：微信用户 → Bridge (3001) → OpenClaw (18790)**

```
1. 微信用户发送消息
2. Wechaty Puppet 接收消息（微信私有协议）
3. WechatyClient.handleMessage() 处理
   ├── 消息去重检查 (processedMessages Set)
   ├── 忽略自己发送的消息
   ├── 消息类型映射 (mapMessageType)
   ├── 图片/视频/语音提取 (FileBox.toBase64/toFile)
   ├── 链接消息解析 (XML 提取 title/des/url)
   ├── 群聊信息获取 (room.topic(), mentionList)
   └── 触发 'message' 事件
4. BridgeServer (3001端口) 接收事件
   └── sendWebhookWithRetry() 发送到 OpenClaw
      POST http://localhost:18790/webhook/wechat
5. callback-server.ts (18790端口) 接收 Webhook
   └── convertToMessageContext() 转换格式
6. bot.ts handleWeChatMessage() 处理
   ├── 消息去重 (tryRecordMessage)
   ├── 构建消息上下文
   ├── 路由到对应 Agent
   └── 调用 reply-dispatcher 处理回复
```

### 3.3 消息发送流程（出站）

**路径：OpenClaw → Bridge (3001) → 微信用户**

```
1. Agent 生成回复
2. OpenClaw Core 调用 wechatPlugin.outbound.sendText()
3. channel.ts sendText() 调用 BridgeClient.sendText()
4. HTTP POST http://localhost:3001/v1/sendText
   Content: { targetId, content }
5. BridgeServer (3001端口) 调用 WechatyClient.sendText()
6. 查找联系人/群 (Contact.find / Room.find)
7. 调用 target.say(content) 发送至微信服务器
8. 返回消息ID和时间戳给 OpenClaw
```

**对比两方向的通信方式：**

| 方向 | 发起方 | 接收方 | 协议 | 路径 |
|------|--------|--------|------|------|
| 入站（收消息） | Bridge | OpenClaw | HTTP POST | 3001 → 18790/webhook/wechat |
| 出站（发消息） | OpenClaw | Bridge | HTTP POST | → 3001/v1/sendText |

---

## 4. 关键代码分析

### 4.1 配置解析逻辑 (channel.ts)

支持两种配置模式：

**简化配置（单账号）**：
```json
{
  "channels": {
    "wechat": {
      "enabled": true,
      "bridgeUrl": "http://localhost:3001",
      "webhookPort": 18790
    }
  }
}
```

**多账号配置**：
```json
{
  "channels": {
    "wechat": {
      "accounts": {
        "account1": { "bridgeUrl": "..." },
        "account2": { "bridgeUrl": "..." }
      }
    }
  }
}
```

### 4.2 消息类型映射 (wechaty-client.ts)

```typescript
private mapMessageType(type: any): MessagePayload['type'] {
  const typeMap: Record<number, MessagePayload['type']> = {
    7: 'text',    // Message.Type.Text
    6: 'image',   // Message.Type.Image
    2: 'voice',   // Message.Type.Voice
    4: 'voice',
    34: 'voice',
    15: 'video',  // Message.Type.Video
    43: 'video',
    1: 'file',    // Message.Type.Attachment
    14: 'link',   // Message.Type.Url
  };
  return typeMap[type] || 'unknown';
}
```

### 4.3 重连机制 (wechaty-client.ts)

```typescript
private async reconnect(): Promise<void> {
  const maxAttempts = this.config.maxReconnectAttempts || 10;

  while (this.reconnectAttempts < maxAttempts) {
    this.reconnectAttempts++;

    // 指数退避: delay = min(5000 * 1.5^(n-1), 60000)
    const baseDelay = this.config.reconnectInterval || 5000;
    const delay = Math.min(baseDelay * Math.pow(1.5, this.reconnectAttempts - 1), 60000);

    await sleep(delay);

    try {
      await this.createAndStartBot();
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      this.emit('reconnected');
      return;
    } catch (error) {
      this.emit('reconnectFailed', { attempt: this.reconnectAttempts, error });
    }
  }

  this.emit('reconnectExhausted', { maxAttempts });
}
```

### 4.4 心跳检测 (wechaty-client.ts)

```typescript
private async checkHeartbeat(): Promise<void> {
  const isLoggedIn = this.bot?.isLoggedIn;

  if (this.isLoggedIn !== isLoggedIn) {
    // 登录状态不一致，增加错过计数
    this.heartbeatMissedCount++;
  } else if (this.isLoggedIn) {
    try {
      const user = this.bot.currentUser;
      if (user) {
        this.heartbeatMissedCount = 0;
        this.emit('heartbeat', { status: 'ok' });
        return;
      }
    } catch (e) {
      this.heartbeatMissedCount++;
    }
  }

  // 连续错过3次心跳，触发重连
  if (this.heartbeatMissedCount >= this.maxMissedHeartbeats) {
    this.emit('heartbeatFailed', { missedCount: this.heartbeatMissedCount });
    this.handleDisconnect('heartbeat');
  }
}
```

### 4.5 图片消息处理 (wechaty-client.ts)

```typescript
if (payload.type === 'image' || payload.type === 'file') {
  const fileBox = await message.toFileBox();
  const base64 = await fileBox.toBase64();
  const mimeType = (fileBox as any).mimeType || 'image/jpeg';

  // 超过3MB的图片保存为文件
  const MAX_BASE64_SIZE = 3 * 1024 * 1024;
  if (base64.length > MAX_BASE64_SIZE) {
    const tempDir = path.join(os.tmpdir(), 'openclaw-wechat-images');
    const filePath = path.join(tempDir, `img-${Date.now()}.jpg`);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    payload.imageUrl = filePath;  // 返回本地文件路径
  } else {
    payload.imageUrl = `data:${mimeType};base64,${base64}`;
  }
}
```

---

## 5. API 接口文档

### 5.1 Bridge HTTP API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/v1/account/status` | 账号状态 |
| POST | `/v1/iPadLogin` | 获取登录二维码 |
| POST | `/v1/getIPadLoginInfo` | 检查登录状态 |
| POST | `/v1/sendText` | 发送文本消息 |
| POST | `/v1/sendImage2` | 发送图片消息 |
| POST | `/v1/getAddressList` | 获取通讯录 |
| POST | `/v1/getRoomMembers` | 获取群成员 |
| POST | `/v1/webhook/register` | 注册 Webhook |
| GET | `/v1/webhook` | 获取 Webhook 配置 |
| GET | `/v1/metrics` | 监控指标 |
| POST | `/v1/logout` | 退出登录 |

### 5.2 Webhook 消息格式

**推送地址：** `POST http://localhost:18790/webhook/wechat`

**推送方：** Bridge 服务（端口 3001）
**接收方：** OpenClaw 插件（端口 18790）

```typescript
{
  id: string;                    // 消息唯一ID
  type: 'text' | 'image' | 'video' | 'voice' | 'link';
  sender: {
    id: string;                  // 发送者 wxid
    name: string;                // 发送者昵称
  };
  recipient: {
    id: string;                  // 接收者 wxid
  };
  content: string;               // 消息内容
  timestamp: number;             // 时间戳(毫秒)
  isGroup: boolean;              // 是否群消息
  group?: {
    id: string;                  // 群ID
    name: string;                // 群名称
  };
  isMentioned?: boolean;         // 是否@了机器人
  mention?: string[];            // @的用户列表
  imageUrl?: string;             // 图片URL/路径
  videoUrl?: string;             // 视频文件路径
  voiceUrl?: string;             // 语音文件路径
  linkUrl?: string;              // 链接URL
  linkTitle?: string;            // 链接标题
  linkDescription?: string;      // 链接描述
}
```

---

## 6. 代码问题分析

### 6.1 严重问题

#### 问题1: 配置键名不一致 ⚠️

**位置**: `src/channel.ts:39`

```typescript
const wechatCfg = cfg.channels?.['openclaw-wechat'] as WechatConfig | undefined;
```

其他位置使用 `cfg.channels?.wechat` 或 `cfg.channels?.['openclaw-wechat']`，存在不一致。

**影响**: 配置可能无法正确读取。

**修复建议**: 统一使用 `openclaw-wechat` 作为配置键名，并确保所有位置一致。

---

### 6.2 中等问题

#### 问题2: Webhook URL 构建缺少 protocol 检查

**位置**: `src/channel.ts:568`

```typescript
const webhookUrl = `http://${account.webhookHost}:${port}${account.webhookPath}`;
```

**问题**: 强制使用 http，如果配置中已经包含协议头会重复。

**修复建议**:
```typescript
let webhookUrl = account.webhookHost || '';
if (!webhookUrl.startsWith('http')) {
  webhookUrl = `http://${webhookUrl}`;
}
webhookUrl = `${webhookUrl}:${port}${account.webhookPath}`;
```

#### 问题3: BridgeClient.checkLogin() 返回值不完整

**位置**: `src/bridge-client.ts:136-168`

当 `result.success && result.loggedIn && result.userInfo` 不满足时，直接返回 `{ status: 'waiting' }`，没有处理 `need_verify` 状态。

**修复建议**: 完善登录状态检测逻辑。

#### 问题4: 发送消息 target 参数类型问题

**位置**: `src/channel.ts:619`

```typescript
const targetId = to?.id || to;
```

`to` 可能是字符串或对象，但类型定义不明确。

---

### 6.3 轻微问题

#### 问题5: 魔法数字未提取为常量

**位置**: `src/bridge/wechaty-client.ts`

```typescript
const MAX_BASE64_SIZE = 3 * 1024 * 1024;  // 应提取为配置常量
const maxMessageHistory: number = 1000;    // 应可配置
```

#### 问题6: 日志调试代码残留

**位置**: `src/channel.ts:38-40`, `src/channel.ts:608`

```typescript
console.log('[DEBUG] resolveWeChatAccount called...');
console.log('[DEBUG channel.ts sendText] to:', JSON.stringify(to));
```

这些调试日志应该使用正式的 logger。

#### 问题7: setAccountEnabled 配置键名错误

**位置**: `src/channel.ts:165-204`

```typescript
return {
  ...cfg,
  channels: {
    ...cfg.channels,
    wechat: {  // 应该是 openclaw-wechat
      ...wechatCfg,
      enabled,
    },
  },
};
```

这里使用了 `wechat` 而不是 `openclaw-wechat`。

---

### 6.4 潜在问题

#### 问题8: 未处理的 Promise Rejection

**位置**: `src/bridge/wechaty-client.ts:110-125`

```typescript
setInterval(() => {
  // 清理逻辑
}, 5 * 60 * 1000);
```

setInterval 的回调如果抛出异常不会被捕获。

#### 问题9: 心跳检测登录状态依赖

```typescript
const isLoggedIn = this.bot?.isLoggedIn;
```

Wechaty 的 `isLoggedIn` 属性可能在某些情况下不准确，应增加更多状态验证。

#### 问题10: 图片临时文件未清理

临时目录 `/tmp/openclaw-wechat-images/` 中的文件不会被自动清理，可能导致磁盘空间不足。

---

## 7. 测试覆盖

### 7.1 单元测试

- `tests/unit/wechaty-client.test.ts` - WechatyClient 核心功能测试
- `tests/unit/bridge-api.test.ts` - Bridge API 测试
- `tests/unit/message-conversion.test.ts` - 消息转换测试
- `tests/unit/config.test.ts` - 配置解析测试

### 7.2 集成测试

- `tests/integration/integration.test.ts` - 完整流程集成测试

---

## 8. 部署配置

### 8.1 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | 3001 | Bridge HTTP 端口（OpenClaw 调用 Bridge） |
| `HOST` | 0.0.0.0 | Bridge 监听地址 |
| `WEBHOOK_PORT` | 18790 | Webhook 回调端口（Bridge 推送消息给 OpenClaw） |
| `WEBHOOK_HOST` | localhost | Webhook 主机 |
| `WEBHOOK_PATH` | /webhook/wechat | Webhook 路径 |
| `WECHATY_PUPPET` | wechaty-puppet-wechat4u | Puppet 类型 |
| `WECHATY_PUPPET_TOKEN` | - | Padlocal Token |
| `AUTO_REGISTER_WEBHOOK` | false | 自动注册 Webhook |
| `SCAN_NOTIFY_ENABLED` | false | 扫码通知开关 |
| `SCAN_NOTIFY_PHONE` | - | 通知手机号 |

**端口关系图示：**

```
OpenClaw Plugin                Bridge Service
┌──────────────┐              ┌──────────────┐
│              │ ←──────────  │              │
│  18790端口   │  HTTP POST   │   3001端口   │
│  (接收消息)  │  Webhook     │  (发送消息)  │
│              │              │              │
│  调用API ───→│  HTTP POST   │              │
│             │              │              │
└──────────────┘              └──────────────┘
```

---

## 9. 常见问题排查

### 9.1 Webhook 相关

**问题：OpenClaw 收不到微信消息**

排查步骤：
1. 检查 18790 端口是否监听
   ```bash
   lsof -i :18790
   ```

2. 测试 Webhook 接口是否可达
   ```bash
   curl http://localhost:18790/webhook/wechat \
     -X POST \
     -H "Content-Type: application/json" \
     -d '{"test":"ping"}'
   ```

3. 检查 Bridge 日志是否有 webhook 发送失败
   ```bash
   tail -f ~/.openclaw/extensions/openclaw-wechat/logs/app-*.log
   ```

**问题：端口 18790 已被占用**

```bash
# 查找占用端口的进程
lsof -i :18790

# 修改配置使用其他端口
openclaw config set channels.openclaw-wechat.webhookPort 18791
```

### 9.2 端口通信问题

**问题：Bridge 返回 "fetch failed"**

原因：Bridge 无法连接到 OpenClaw 的 18790 端口

排查：
1. OpenClaw Gateway 是否已启动
2. 防火墙是否阻挡了 18790 端口
3. 如果是远程部署，检查 webhookHost 是否为公网 IP

**问题：Gateway 启动慢/卡住**

可能原因：
- iMessage 渠道权限问题（检查 gateway.err.log）
- Bridge 未运行导致 registerWebhook 超时（应添加超时处理）

---

## 10. 总结

### 9.1 实现亮点

1. **Bridge 架构**：清晰分离协议层和业务层
2. **完善的重连机制**：指数退避 + 最大重试次数
3. **心跳检测**：主动检测连接健康状态
4. **消息去重**：防止重复处理
5. **联系人缓存**：提升性能，减少API调用
6. **多种消息类型支持**：文本、图片、视频、语音、链接

### 9.2 需要改进的地方

1. **配置键名统一**：确保所有位置使用一致的键名
2. **错误处理完善**：增加更多边界情况处理
3. **日志规范化**：移除调试日志，使用统一 logger
4. **临时文件清理**：增加定期清理机制
5. **类型安全**：完善 TypeScript 类型定义

### 9.3 总体评价

代码整体结构清晰，功能实现完整，具备生产环境运行能力。建议优先修复配置键名不一致的问题，然后进行代码规范化和测试完善。
