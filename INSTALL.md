# OpenClaw WeChat 插件 - 快速安装指南

## 📋 环境要求

- Node.js >= 18
- OpenClaw >= 2026.2.9
- 已运行的 OpenClaw Gateway
- npm（用于安装插件依赖）

## 📦 安装步骤

### 1. 安装插件

在 OpenClaw 中安装此插件：

```bash
openclaw plugins install /path/to/openclaw-wechat
```

例如：

```bash
openclaw plugins install /mnt/d/works/openclaw-wechat
```

### 2. 安装依赖

安装完成后，需要在扩展目录手动安装依赖：

```bash
cd ~/.openclaw/extensions/openclaw-wechat
npm install
```

### 3. 验证安装

检查必要文件是否存在：

```bash
ls ~/.openclaw/extensions/openclaw-wechat/
```

应该包含：

- `src/` - 源代码
- `node_modules/` - 依赖
- `package.json`
- `index.ts`

如果缺少文件，需要手动复制：

```bash
cp -r /path/to/openclaw-wechat/src ~/.openclaw/extensions/openclaw-wechat/
cp /path/to/openclaw-wechat/package.json ~/.openclaw/extensions/openclaw-wechat/
```

安装插件后，需要配置 WeChat 渠道：

```bash
# 启用 WeChat 渠道
openclaw config set channels.wechat.enabled true

# 设置 Bridge 服务地址
openclaw config set channels.wechat.bridgeUrl "http://localhost:3001"

# 设置 webhook 端口（插件的回调端口，默认 18790）
openclaw config set channels.wechat.webhookHost "localhost"
openclaw config set channels.wechat.webhookPort 18790
openclaw config set channels.wechat.webhookPath "/webhook/wechat"
```

或者直接编辑配置文件 `~/.openclaw/openclaw.json`：

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

### 3. 重启 OpenClaw Gateway

```bash
openclaw gateway restart
```

### 4. 启动 Bridge 服务

```bash
# 进入插件目录
cd ~/.openclaw/extensions/wechat

# 启动 Bridge 服务
npm run start:bridge

# 或者使用启动脚本
./start-bridge.sh
```

Bridge 服务默认配置：

- 端口：3001
- webhook 端口：18790（OpenClaw 插件的回调地址）

## 📱 登录微信

1. 启动 Bridge 服务后，终端会显示二维码链接
2. 复制链接到浏览器打开，或直接使用终端显示的二维码
3. 使用微信扫描二维码登录
4. 登录成功后，会显示登录成功信息

## ✅ 验证对接

### 1. 检查 Bridge 服务

```bash
# 测试健康检查接口
curl http://localhost:3001/health

# 查看账号状态
curl http://localhost:3001/v1/account/status
```

预期输出：

```json
{
  "status": "ok",
  "wechaty": "ready",
  "loggedIn": true
}
```

### 2. 检查 webhook 注册

Bridge 登录成功后，OpenClaw 会自动注册 webhook。检查注册状态：

```bash
curl http://localhost:3001/v1/webhook
```

预期输出：

```json
{
  "registered": true,
  "webhookUrl": "http://localhost:18790/webhook/wechat"
}
```

### 3. 测试消息收发

- 用微信给 Bot 发消息
- 检查 Bridge 日志：`tail -f ~/.openclaw/extensions/wechat/logs/app-*.log`
- 检查 OpenClaw 日志：`openclaw logs`

## 🔧 高级配置

### 使用 padlocal token（更稳定）

1. 获取 padlocal token
2. 修改 `~/.openclaw/extensions/wechat/.env`：

```bash
WECHATY_PUPPET=wechaty-puppet-padlocal
WECHATY_PUPPET_TOKEN=your-token-here
```

3. 重启 Bridge 服务

### 配置自动启动

使用 systemd：

```bash
# 复制服务文件
sudo cp ~/.openclaw/extensions/wechat/openclaw-wechat.service /etc/systemd/system/

# 启用服务
sudo systemctl enable openclaw-wechat

# 启动服务
sudo systemctl start openclaw-wechat

# 查看状态
sudo systemctl status openclaw-wechat
```

## 📊 监控和日志

### 查看日志

```bash
# Bridge 服务日志
tail -f ~/.openclaw/extensions/wechat/logs/app-$(date +%Y-%m-%d).log

# OpenClaw 日志
openclaw logs
```

### 查看监控指标

```bash
curl http://localhost:3001/v1/metrics
```

## 🔍 常见问题

### Q: Bridge 启动失败？

1. 检查 Node.js 版本：`node --version`（需要 >= 18）
2. 检查端口是否被占用：`lsof -i :3001`
3. 查看错误日志

### Q: 无法扫描二维码？

1. 确保网络连接正常（可以访问 weixin.qq.com）
2. 检查防火墙设置，端口 3001 是否开放
3. 查看日志：`tail -f logs/app-*.log`

### Q: OpenClaw 收不到消息？

1. 检查 webhook 地址配置是否正确
2. 确认 Bridge 和 OpenClaw 在同一台机器
3. 查看 Bridge 日志是否有 "Webhook registered" 信息
4. 检查 OpenClaw 配置：`openclaw config get channels.wechat`

### Q: 发送消息失败？

1. 检查 Bridge 登录状态：`curl http://localhost:3001/v1/account/status`
2. 查看 Bridge 日志是否有错误信息

## 📁 文件说明

安装后，插件文件位于：`~/.openclaw/extensions/wechat/`

主要文件：

- `src/channel.ts` - 渠道实现
- `src/bridge/server.ts` - Bridge 服务端
- `src/bridge-client.ts` - Bridge 客户端
- `src/bot.ts` - Bot 消息处理
- `src/reply-dispatcher.ts` - 回复分发器
- `openclaw.plugin.json` - 插件清单
- `start-bridge.sh` - 启动脚本

---

**安装完成！** 🎉
