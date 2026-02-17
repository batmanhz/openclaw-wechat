# openclaw-wechat

WeChat (微信) channel plugin for [OpenClaw](https://github.com/openclaw/openclaw), based on [Wechaty](https://wechaty.js.org/) - fully local deployment without third-party dependencies.

[English](#english) | [中文](#中文)

---

## English

### Overview

This plugin integrates WeChat with OpenClaw using the Wechaty framework, enabling:

- **Fully local deployment** - No third-party proxy services required
- **Data privacy** - All messages processed locally
- **Cost reduction** - No API Key or service fees
- **Wechaty ecosystem** - Support for multiple puppet implementations

### Architecture

**Local Deployment (Recommended)**:

```
┌─────────────────────────────────────────────────────────┐
│                     Local Machine                       │
│                                                         │
│  ┌────────────────┐         ┌────────────────────────┐ │
│  │  OpenClaw      │         │   Wechaty Bridge       │ │
│  │  Plugin        │←───────→│   (HTTP Server)        │ │
│  │                │         │                        │ │
│  └────────────────┘         └──────────┬─────────────┘ │
│        ▲                               │               │
│        │ localhost:18790              localhost:3001   │
│        └───────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
                                         │
                                         │ WeChat Protocol
                                         ▼
                                  ┌──────────────┐
                                  │ WeChat Server│
                                  └──────────────┘
```

- ✅ **No public IP required** - All components run on the same machine
- ✅ **Zero configuration** - Works out of the box with localhost
- ✅ **Single machine** - OpenClaw, Bridge, and Wechaty all local

### Prerequisites

- Node.js >= 18
- WeChat account (recommend using a secondary account for testing)

### Installation

```bash
openclaw plugins install @canghe/openclaw-wechat
```

### Configuration

#### Quick Start (Local)

For local deployment, you only need to set the Bridge URL:

```bash
# Set Bridge URL (default: http://localhost:3001)
openclaw config set channels.wechat.bridgeUrl "http://localhost:3001"

# Enable the channel
openclaw config set channels.wechat.enabled true
```

**That's it!** For local deployment, no other configuration is needed. All components communicate via localhost.

#### Cloud Deployment (Optional)

Only needed if deploying components on separate machines:

```bash
# Set public webhook URL for remote access
openclaw config set channels.wechat.webhookHost "your-server-ip"
```

### Bridge Setup

The Bridge service acts as a middle layer between OpenClaw and Wechaty.

#### Option 1: Using Docker (Recommended)

```bash
docker run -d \
  --name wechaty-bridge \
  -p 3001:3001 \
  -p 18790:18790 \
  -v ./data:/app/data \
  -v ./logs:/app/logs \
  openclaw/wechaty-bridge:latest
```

#### Option 2: Using npm

```bash
npm install -g @canghe/wechaty-bridge
wechaty-bridge start
```

### Configuration Options

```yaml
# ~/.openclaw/openclaw.json
channels:
  wechat:
    enabled: true
    bridgeUrl: 'http://localhost:3001' # Required - Bridge service URL

    # Webhook configuration (optional for local, required for cloud)
    # Default: localhost - no need to change for local deployment
    webhookHost: 'localhost' # Default: localhost
    webhookPort: 18790 # Default: 18790
    webhookPath: '/webhook/wechat' # Default: /webhook/wechat

    # Puppet configuration (optional)
    puppet: 'wechaty-puppet-wechat' # Default: wechaty-puppet-wechat
    # puppetToken: ""                     # Required for padlocal protocol
```

### First-time Login

1. Start the Bridge service
2. Start the OpenClaw gateway:

```bash
openclaw gateway start
```

3. A QR code will be displayed in the console
4. Scan it with WeChat to log in

### WeChat Account Setup

#### Account Requirements

**No special account needed!** You can use a regular personal WeChat account:

- ❌ No enterprise WeChat required
- ❌ No developer account required
- ❌ No open platform account required
- ✅ Just a regular WeChat account (phone number registered)

#### Why Use a Secondary Account?

**We recommend using a secondary/spare WeChat account for testing:**

| Risk             | Description                           | Recommendation                                   |
| ---------------- | ------------------------------------- | ------------------------------------------------ |
| Account ban      | WeChat may detect automation          | Use a spare account to protect your main account |
| Message limits   | Frequent messaging may trigger limits | Use for testing first                            |
| Easy replacement | If banned, easily switch accounts     | Register a backup account                        |

**How to get a secondary account:**

```bash
# Option 1: Register a new account
- Use a spare phone number
- Complete real-name verification (optional but recommended)

# Option 2: Use an old unused account
- Family member's spare account
- Old phone number's WeChat account
```

#### Login Process

**QR Code Login (Not password!):**

```
Step 1: Start the service
  ↓
Step 2: Console displays QR code
  ↓
Step 3: Open WeChat on your phone
  ↓
Step 4: Tap "+" → "Scan"
  ↓
Step 5: Scan the QR code in console
  ↓
Step 6: Confirm login on your phone
  ↓
Step 7: Bot is online! ✓
```

#### Session Persistence

After first login, your session is automatically saved:

- Session stored in local file (`./wechaty-session.json`)
- Auto-reconnect after service restart
- No need to scan QR code every time
- To logout manually: call `POST /v1/logout` API

#### Switch Account

To switch to a different WeChat account:

```bash
curl -X POST http://localhost:3001/v1/logout
```

This will clear the session and stop the bot. Then restart bridge to scan QR code with a new account.

#### Important Notes

⚠️ **To avoid account ban:**

1. **Use secondary account** - Never use your main WeChat for testing
2. **Control message frequency** - Don't send too many messages rapidly
3. **Avoid sensitive content** - No political, pornographic, or gambling content
4. **Don't spam** - Avoid sending same message to many groups
5. **Stay online** - Keep service running, avoid frequent restarts

⚠️ **Login verification:**

- First login on new device may require friend verification
- Have 2+ WeChat friends ready to verify if needed
- Some accounts may need SMS verification

### Features

- ✅ Direct messages and group chats
- ✅ Text and image messages
- ✅ QR code login flow
- ✅ Session persistence (auto-reconnect)
- ✅ Multi-account support
- ✅ Fully local deployment
- ✅ No third-party dependencies

### FAQ

#### Bot cannot receive messages (Local)

1. Make sure Bridge service is running: `docker ps` or check the terminal
2. Check if the gateway is running: `openclaw gateway status`
3. Check Bridge service logs: `docker logs wechaty-bridge`
4. For local deployment, `webhookHost` should be `localhost` (default)

#### Bot cannot receive messages (Cloud)

1. Make sure `webhookHost` is configured with your server's public IP
2. Make sure `webhookPort` is accessible from the internet
3. Check firewall rules for port 18790

#### How to use multiple accounts

```yaml
channels:
  wechat:
    accounts:
      work:
        bridgeUrl: 'http://localhost:3001'
        enabled: true
      personal:
        bridgeUrl: 'http://localhost:3002'
        enabled: true
```

#### How to switch to padlocal protocol

1. Get a padlocal token from [Wechaty Puppet PadLocal](https://github.com/wechaty/puppet-padlocal)
2. Configure:

```bash
openclaw config set channels.wechat.puppet "wechaty-puppet-padlocal"
openclaw config set channels.wechat.puppetToken "your-padlocal-token"
```

---

## 中文

### 概述

本插件使用 Wechaty 框架将微信集成到 OpenClaw，实现：

- **完全本地部署** - 无需第三方代理服务
- **数据隐私保护** - 所有消息本地处理
- **零成本运行** - 无需 API Key 或服务费用
- **Wechaty 生态** - 支持多种协议实现

### 架构

**本地部署（推荐）**：

```
┌─────────────────────────────────────────────────────────┐
│                     本地计算机                          │
│                                                         │
│  ┌────────────────┐         ┌────────────────────────┐ │
│  │  OpenClaw      │         │   Wechaty Bridge       │ │
│  │  插件          │←───────→│   (HTTP 服务)          │ │
│  │                │         │                        │ │
│  └────────────────┘         └──────────┬─────────────┘ │
│        ▲                               │               │
│        │ localhost:18790              localhost:3001   │
│        └───────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
                                         │
                                         │ 微信协议
                                         ▼
                                  ┌──────────────┐
                                  │  微信服务器   │
                                  └──────────────┘
```

- ✅ **无需公网 IP** - 所有组件在同一台机器运行
- ✅ **零配置** - 开箱即用，使用 localhost
- ✅ **单机部署** - OpenClaw、Bridge 和 Wechaty 全部本地化

### 环境要求

- Node.js >= 18
- 微信账号（建议使用小号测试）

### 安装

```bash
openclaw plugins install @canghe/openclaw-wechat
```

### 配置

#### 快速开始（本地）

本地部署只需设置 Bridge URL：

```bash
# 设置 Bridge URL（默认: http://localhost:3001）
openclaw config set channels.wechat.bridgeUrl "http://localhost:3001"

# 启用通道
openclaw config set channels.wechat.enabled true
```

**完成！** 本地部署不需要其他配置，所有组件通过 localhost 通信。

#### 云部署（可选）

仅当组件部署在不同机器上时才需要：

```bash
# 设置公网 webhook 地址（远程访问时需要）
openclaw config set channels.wechat.webhookHost "你的服务器IP"
```

### Bridge 配置

Bridge 服务作为 OpenClaw 和 Wechaty 之间的中间层。

#### 方案 1：使用 Docker（推荐）

```bash
docker run -d \
  --name wechaty-bridge \
  -p 3001:3001 \
  -p 18790:18790 \
  -v ./data:/app/data \
  -v ./logs:/app/logs \
  openclaw/wechaty-bridge:latest
```

#### 方案 2：使用 npm

```bash
npm install -g @canghe/wechaty-bridge
wechaty-bridge start
```

### 配置选项

```yaml
# ~/.openclaw/openclaw.json
channels:
  wechat:
    enabled: true
    bridgeUrl: 'http://localhost:3001' # 必填 - Bridge 服务地址

    # Webhook 配置（本地部署可选，云部署必填）
    # 默认值: localhost - 本地部署无需修改
    webhookHost: 'localhost' # 默认: localhost
    webhookPort: 18790 # 默认: 18790
    webhookPath: '/webhook/wechat' # 默认: /webhook/wechat

    # Puppet 配置（可选）
    puppet: 'wechaty-puppet-wechat' # 默认: wechaty-puppet-wechat
    # puppetToken: ""                     # 使用 padlocal 协议时需要
```

### 首次登录

1. 启动 Bridge 服务
2. 启动 OpenClaw gateway：

```bash
openclaw gateway start
```

3. 控制台会显示二维码
4. 用微信扫码登录

### 微信账号配置

#### 账号要求

**不需要特殊账号！** 使用普通个人微信即可：

- ❌ 无需企业微信
- ❌ 无需开发者账号
- ❌ 无需开放平台账号
- ✅ 只需普通微信账号（手机号注册）

#### 为什么建议用小号？

**我们强烈建议使用小号进行测试：**

| 风险     | 说明                     | 建议                   |
| -------- | ------------------------ | ---------------------- |
| 封号风险 | 微信可能检测到自动化行为 | 用小号避免主号受到影响 |
| 消息限制 | 频繁发消息可能触发限制   | 先用小号测试           |
| 易于更换 | 如被封可随时换号         | 提前注册备用号         |

**如何获取小号：**

```bash
# 方案 1：注册新账号
- 使用备用手机号注册
- 完成实名认证（可选但建议）

# 方案 2：使用闲置的旧号
- 家人的备用号
- 旧手机号注册的微信
```

#### 登录流程

**二维码登录（不是账号密码！）：**

```
第 1 步：启动服务
  ↓
第 2 步：控制台显示二维码
  ↓
第 3 步：手机打开微信
  ↓
第 4 步：点击"+" → "扫一扫"
  ↓
第 5 步：扫描控制台的二维码
  ↓
第 6 步：手机上确认登录
  ↓
第 7 步：机器人上线！✓
```

#### 会话保持

首次登录后会自动保存会话状态：

- 会话信息保存在本地文件（`./wechaty-session.json`）
- 服务重启后自动重连
- 无需每次都扫码
- 手动退出：删除会话文件即可

#### 重要提示

⚠️ **避免账号被封：**

1. **使用小号** - 绝对不要用主号测试
2. **控制频率** - 不要频繁发送大量消息
3. **避免敏感词** - 不发送政治、色情、赌博等内容
4. **不要刷屏** - 避免向多个群发送相同消息
5. **保持在线** - 尽量保持服务运行，避免频繁重启

⚠️ **登录验证：**

- 首次在新设备登录可能需要好友辅助验证
- 准备 2 个以上微信好友，以备验证需要
- 部分账号可能需要短信验证

### 功能

- ✅ 私聊和群聊
- ✅ 文本和图片消息
- ✅ 二维码登录流程
- ✅ 会话保持（自动重连）
- ✅ 多账号支持
- ✅ 完全本地部署
- ✅ 无第三方依赖

### 常见问题

#### 机器人收不到消息（本地）

1. 确保 Bridge 服务正在运行：`docker ps` 或查看终端
2. 检查 gateway 是否运行：`openclaw gateway status`
3. 检查 Bridge 服务日志：`docker logs wechaty-bridge`
4. 本地部署时，`webhookHost` 应为 `localhost`（默认值）

#### 机器人收不到消息（云服务器）

1. 确保 `webhookHost` 配置了服务器的公网 IP
2. 确保 `webhookPort` 端口可从外网访问
3. 检查防火墙规则，放行 18790 端口

#### 如何使用多账号

```yaml
channels:
  wechat:
    accounts:
      work:
        bridgeUrl: 'http://localhost:3001'
        enabled: true
      personal:
        bridgeUrl: 'http://localhost:3002'
        enabled: true
```

#### 如何切换到 padlocal 协议

1. 从 [Wechaty Puppet PadLocal](https://github.com/wechaty/puppet-padlocal) 获取 token
2. 配置：

```bash
openclaw config set channels.wechat.puppet "wechaty-puppet-padlocal"
openclaw config set channels.wechat.puppetToken "your-padlocal-token"
```

---

## 申明

本插件仅供学习和研究使用，请勿用于非法用途，否则后果自负。

## 交流群

关于 bot 进群交流请扫码关注，并回复：openclaw-wechat

![](./images/%E7%BE%A4%E8%81%8A%E4%BA%A4%E6%B5%81.bmp)

## Star 趋势图

[![Star History Chart](https://api.star-history.com/svg?repos=freestylefly/openclaw-wechat&type=Date)](https://star-history.com/#freestylefly/openclaw-wechat&Date)

## License

MIT
