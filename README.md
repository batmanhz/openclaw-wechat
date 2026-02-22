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
- OpenClaw >= 2026.2.9
- WeChat account (recommend using a secondary account for testing)

### Installation

#### Option 1: Automatic Installation (Recommended)

Use the provided installation script:

```bash
chmod +x install-plugin.sh
./install-plugin.sh
```

#### Option 2: Manual Installation

1. Install the plugin in OpenClaw:

```bash
openclaw plugins install /path/to/openclaw-wechat
```

2. Copy required files to the extension directory:

```bash
EXTENSION_DIR=~/.openclaw/extensions/openclaw-wechat

# Copy source code
cp -r /path/to/openclaw-wechat/src $EXTENSION_DIR/

# Copy configuration files
cp /path/to/openclaw-wechat/package.json $EXTENSION_DIR/
cp /path/to/openclaw-wechat/tsconfig.json $EXTENSION_DIR/
cp /path/to/openclaw-wechat/start-bridge.sh $EXTENSION_DIR/
cp /path/to/openclaw-wechat/openclaw.plugin.json $EXTENSION_DIR/
```

3. Install dependencies:

```bash
cd ~/.openclaw/extensions/openclaw-wechat
npm install
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

#### Start Bridge

Navigate to the extension directory and start the Bridge service:

```bash
cd ~/.openclaw/extensions/openclaw-wechat
./start-bridge.sh
```

Or use npm:

```bash
cd ~/.openclaw/extensions/openclaw-wechat
npm run start:bridge
```

This will:

1. Check Node.js version (requires Node.js >= 18)
2. Install dependencies if needed
3. Start the Bridge HTTP server on port 3001

After starting, the console will display:

```
API Endpoints:
  Health Check:  http://localhost:3001/health
  Account Status: http://localhost:3001/v1/account/status
  Login:         http://localhost:3001/v1/iPadLogin
```

### Configuration Options

Edit `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "wechat": {
      "enabled": true,
      "bridgeUrl": "http://localhost:3001",
      "webhookHost": "localhost",
      "webhookPort": 18790,
      "webhookPath": "/webhook/wechat"
    }
  }
}
```

| Option        | Description                                   | Default                 |
| ------------- | --------------------------------------------- | ----------------------- |
| `enabled`     | Enable the WeChat channel                     | `false`                 |
| `bridgeUrl`   | Bridge service URL                            | `http://localhost:3001` |
| `webhookHost` | Webhook host for OpenClaw to receive messages | `localhost`             |
| `webhookPort` | Webhook port                                  | `18790`                 |
| `webhookPath` | Webhook path                                  | `/webhook/wechat`       |

### First-time Login

1. Start the Bridge service:

```bash
cd ~/.openclaw/extensions/openclaw-wechat
./start-bridge.sh
```

2. The console will display a QR code login URL:

```
Scan QR Code to login: 2
https://wechaty.js.org/qrcode/...
```

3. **Copy the URL and open it in your browser** - a QR code will be displayed
4. Scan the QR code with WeChat to log in
5. After successful login, the console will show:

```
User <nickname> logged in
```

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
Step 1: Run ./start-bridge.sh
  ↓
Step 2: Console displays QR code URL
  ↓
Step 3: Copy URL and open in browser
  ↓
Step 4: Browser displays QR code image
  ↓
Step 5: Open WeChat on your phone
  ↓
Step 6: Tap "+" → "Scan"
  ↓
Step 7: Scan the QR code in browser
  ↓
Step 8: Confirm login on your phone
  ↓
Step 9: Bot is online! ✓
```

#### Session Persistence

After first login, your session is automatically saved:

- Session stored in local file (`./openclaw-wechat.memory-card.json`)
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

1. Make sure Bridge service is running: check terminal or `curl http://localhost:3001/health`
2. Check if you're logged in: `curl http://localhost:3001/v1/account/status`
3. For local deployment, `webhookHost` should be `localhost` (default)

#### Bot cannot receive messages (Cloud)

1. Make sure `webhookHost` is configured with your server's public IP
2. Make sure `webhookPort` is accessible from the internet
3. Check firewall rules for port 18790

#### How to use multiple accounts

```json
{
  "channels": {
    "wechat": {
      "accounts": {
        "work": {
          "bridgeUrl": "http://localhost:3001",
          "enabled": true
        },
        "personal": {
          "bridgeUrl": "http://localhost:3002",
          "enabled": true
        }
      }
    }
  }
}
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
- OpenClaw >= 2026.2.9
- 微信账号（建议使用小号测试）

### 安装

#### 方案 1：自动安装（推荐）

使用提供的安装脚本：

```bash
chmod +x install-plugin.sh
./install-plugin.sh
```

#### 方案 2：手动安装

1. 在 OpenClaw 中安装插件：

```bash
openclaw plugins install /path/to/openclaw-wechat
```

2. 复制必要文件到扩展目录：

```bash
EXTENSION_DIR=~/.openclaw/extensions/openclaw-wechat

# 复制源代码
cp -r /path/to/openclaw-wechat/src $EXTENSION_DIR/

# 复制配置文件
cp /path/to/openclaw-wechat/package.json $EXTENSION_DIR/
cp /path/to/openclaw-wechat/tsconfig.json $EXTENSION_DIR/
cp /path/to/openclaw-wechat/start-bridge.sh $EXTENSION_DIR/
cp /path/to/openclaw-wechat/openclaw.plugin.json $EXTENSION_DIR/
```

3. 安装依赖：

```bash
cd ~/.openclaw/extensions/openclaw-wechat
npm install
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

#### 启动 Bridge

进入扩展目录并启动 Bridge 服务：

```bash
cd ~/.openclaw/extensions/openclaw-wechat
./start-bridge.sh
```

或使用 npm：

```bash
cd ~/.openclaw/extensions/openclaw-wechat
npm run start:bridge
```

这将：

1. 检查 Node.js 版本（需要 Node.js >= 18）
2. 如需要则自动安装依赖
3. 在端口 3001 启动 Bridge HTTP 服务

启动后，控制台会显示：

```
API Endpoints:
  Health Check:  http://localhost:3001/health
  Account Status: http://localhost:3001/v1/account/status
  Login:         http://localhost:3001/v1/iPadLogin
```

### 配置选项

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "channels": {
    "wechat": {
      "enabled": true,
      "bridgeUrl": "http://localhost:3001",
      "webhookHost": "localhost",
      "webhookPort": 18790,
      "webhookPath": "/webhook/wechat"
    }
  }
}
```

| 配置项        | 说明                             | 默认值                  |
| ------------- | -------------------------------- | ----------------------- |
| `enabled`     | 启用微信通道                     | `false`                 |
| `bridgeUrl`   | Bridge 服务地址                  | `http://localhost:3001` |
| `webhookHost` | OpenClaw 接收消息的 webhook 主机 | `localhost`             |
| `webhookPort` | Webhook 端口                     | `18790`                 |
| `webhookPath` | Webhook 路径                     | `/webhook/wechat`       |

### 首次登录

1. 启动 Bridge 服务：

```bash
cd ~/.openclaw/extensions/openclaw-wechat
./start-bridge.sh
```

2. 控制台会显示扫码登录链接：

```
Scan QR Code to login: 2
https://wechaty.js.org/qrcode/...
```

3. **复制该链接并在浏览器中打开** - 页面会显示二维码
4. 用微信扫码登录
5. 登录成功后，控制台会显示：

```
User <昵称> logged in
```

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
第 1 步：运行 ./start-bridge.sh
   ↓
第 2 步：控制台显示二维码链接
   ↓
第 3 步：复制链接并在浏览器中打开
   ↓
第 4 步：浏览器显示二维码图片
   ↓
第 5 步：手机打开微信
   ↓
第 6 步：点击"+" → "扫一扫"
   ↓
第 7 步：扫描浏览器中的二维码
   ↓
第 8 步：手机上确认登录
   ↓
第 9 步：机器人上线！✓
```

#### 会话保持

首次登录后会自动保存会话状态：

- 会话信息保存在本地文件（`./openclaw-wechat.memory-card.json`）
- 服务重启后自动重连
- 无需每次都扫码
- 手动退出：调用 `POST /v1/logout` API

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

1. 确保 Bridge 服务正在运行：检查终端或 `curl http://localhost:3001/health`
2. 检查是否已登录：`curl http://localhost:3001/v1/account/status`
3. 本地部署时，`webhookHost` 应为 `localhost`（默认值）

#### 机器人收不到消息（云服务器）

1. 确保 `webhookHost` 配置了服务器的公网 IP
2. 确保 `webhookPort` 端口可从外网访问
3. 检查防火墙规则，放行 18790 端口

#### 如何使用多账号

```json
{
  "channels": {
    "wechat": {
      "accounts": {
        "work": {
          "bridgeUrl": "http://localhost:3001",
          "enabled": true
        },
        "personal": {
          "bridgeUrl": "http://localhost:3002",
          "enabled": true
        }
      }
    }
  }
}
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

## License

MIT
