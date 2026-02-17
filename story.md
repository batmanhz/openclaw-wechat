# Story: OpenClaw WeChat Wechaty Integration

## 背景

当前 OpenClaw 的微信插件依赖于第三方商业服务"苍何服务云"，需要通过 API Key 进行身份验证和计费。本项目将基于开源框架 Wechaty 重构微信对接能力，实现私有化部署、降低成本并提高数据安全性。

## 目标

### 核心目标
- **完全本地部署**：所有组件在单一机器运行，无需公网 IP
- **零配置启动**：开箱即用，仅需配置 bridgeUrl
- **完全移除第三方依赖**：无需 API Key、代理服务或云服务
- **保持 OpenClaw 兼容性**：无缝集成现有架构

### 功能目标
- 支持私聊和群聊消息收发
- 支持文本和图片消息
- 提供二维码登录流程
- 支持会话持久化和自动重连

## 架构决策

### 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenClaw Core                          │
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │  Channel Router │  │      WeChat Plugin (改造后)      │   │
│  └────────┬────────┘  └──────────────────┬──────────────┘   │
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

### 部署架构

**本地部署（推荐）**：
```
┌─────────────────────────────────────────────────────────────┐
│                      本地计算机                             │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │  OpenClaw Core  │  │   WeChat Plugin                 │   │
│  └────────┬────────┘  └──────────┬──────────────────────┘   │
│           │                      │                          │
│           │ localhost:3001       │ localhost:18790          │
│           │                      │                          │
│           ▼                      ▼                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Wechaty Bridge (HTTP)                     │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │              Wechaty Core                        │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ 微信协议
                           ▼
                    ┌──────────────┐
                    │  微信服务器   │
                    └──────────────┘
```

- **所有组件在同一台机器上运行**
- **无需公网 IP**，所有通信使用 localhost
- **零配置**，开箱即用

### 技术选型

| 组件 | 当前实现 | 新实现 | 说明 |
|------|---------|--------|------|
| 通信协议 | ProxyClient (HTTP) | WechatyClient (Node.js API) | 直接调用 Wechaty API |
| 消息格式 | 第三方代理服务 HTTP JSON 格式 | Wechaty Message 对象 | 标准 Wechaty 格式 |
| 登录方式 | API Key + 代理服务 | 本地二维码扫码 | 完全本地化 |
| 配置方式 | apiKey + proxyUrl | bridgeUrl (localhost) | 简化配置 |

## Story 分解

### Story 1: Bridge 服务基础框架

**优先级**: P0
**预估工时**: 2-3 天

**描述**: 
创建独立的 Bridge 服务，作为 OpenClaw 插件与 Wechaty 框架之间的中间层。

**任务清单**:
1. 创建项目结构
   - [X] 创建 `src/bridge/` 目录
   - [X] 创建基础文件: server.ts, wechaty-client.ts
   - [X] 添加 wechaty 依赖 (express, wechaty, wechaty-puppet-wechat)

2. 实现 WechatyClient 核心类
   - [X] 封装 Wechaty 实例创建 (WechatyBuilder.build)
   - [X] 实现事件处理器 (scan, login, logout, message, error)
   - [X] 实现消息类型映射 (mapMessageType)
   - [X] 实现登录状态管理 (isLoggedIn, wcId, nickName)

3. 实现 Bridge HTTP Server
   - [X] 使用 Express 创建 HTTP 服务
   - [X] 实现基础路由 (/health)
   - [X] 实现账号状态接口 (/v1/account/status)
   - [X] 实现二维码获取接口 (/v1/iPadLogin)
   - [X] 实现登录状态检查接口 (/v1/getIPadLoginInfo)

**已实现文件**:
- `src/bridge/wechaty-client.ts` - Wechaty 客户端封装
- `src/bridge/server.ts` - Bridge HTTP 服务
- `package.json` - 添加 wechaty/express 依赖和启动脚本

**启动方式**:
```bash
npm run start:bridge
# 或
npx tsx src/bridge/server.ts
```

**API 接口**:
- `GET /health` - 健康检查
- `GET /v1/account/status` - 获取账号状态
- `POST /v1/iPadLogin` - 获取登录二维码
- `POST /v1/getIPadLoginInfo` - 检查登录状态
- `POST /v1/sendText` - 发送文本消息
- `POST /v1/sendImage2` - 发送图片消息
- `POST /v1/getAddressList` - 获取通讯录
- `POST /v1/webhook/register` - 注册 webhook

**API 测试结果** (2026-02-16):

```bash
✅ Test 1: Health Check
   Response: {"status":"ok","timestamp":1771249990621}
   Status: PASSED

✅ Test 2: Account Status  
   Response: {"valid":true,"isLoggedIn":false,"wcId":"","nickName":"","error":null}
   Status: PASSED

✅ Test 3: QR Code Login
   Response: {"wId":"session-1771249941373","qrCodeUrl":"https://wechaty.js.org/qrcode/..."}
   Status: PASSED

✅ Test 4: Login Info
   Response: {"status":"waiting","wcId":"","nickName":"","headUrl":""}
   Status: PASSED

All Story 1 API tests: 4/4 PASSED ✅
```

**验收标准**:
- [X] Bridge 服务可以独立启动
- [X] 可以通过 API 获取二维码 URL
- [X] 可以检查登录状态

**Story 1 完成！** 🎉

---

### Story 2: 消息收发功能

**优先级**: P0
**依赖**: Story 1
**预估工时**: 3-4 天

**描述**:
实现完整的消息收发功能，包括接收微信消息并推送给 OpenClaw，以及从 OpenClaw 接收回复并发送给微信。

**任务清单**:
1. 消息接收功能
   - [X] 实现消息监听 (onMessage 事件处理)
   - [X] 实现消息格式转换 (Wechaty → OpenClaw)
   - [X] 实现 Webhook 推送机制 (含3次重试和指数退避)
   - [X] 实现消息去重和过滤 (消息ID去重，最大1000条历史)

2. 消息发送功能
   - [X] 实现文本消息发送接口 (/v1/sendText)
   - [X] 实现图片消息发送接口 (/v1/sendImage2，使用 FileBox)
   - [X] 实现联系人/群组查找逻辑 (Contact.find / Room.find)
   - [X] 实现消息发送结果返回 (msgId, newMsgId, createTime)

3. 群聊功能
   - [X] 识别群聊消息 (payload.group)
   - [X] 处理 @ 提及消息 (mentionList, isMentioned)
   - [X] 支持群聊消息发送 (通过 Room.find)

**实现详情**:

1. **wechaty-client.ts 增强**:
   - 添加 `processedMessages` Set 实现消息去重
   - 添加消息清理定时器 (每5分钟清理过期消息)
   - 完善 `handleMessage` 方法，支持 @提及检测
   - 实现 `sendImage` 方法，使用 FileBox 发送图片
   - 添加消息元数据 (mention, isMentioned, group)

2. **server.ts 增强**:
   - 添加 `sendWebhookWithRetry` 方法 (最多3次重试)
   - 完善 `convertToWebhookFormat` 支持群聊字段
   - 添加 `/v1/webhook` GET 接口查询配置
   - 添加 `/v1/test/send-message` 测试接口
   - Webhook 推送包含 X-Webhook-Attempt 头部

3. **依赖更新**:
   - 添加 `file-box` 依赖用于图片发送

**API 端点**:
- `POST /v1/sendText` - 发送文本消息
- `POST /v1/sendImage2` - 发送图片消息  
- `POST /v1/webhook/register` - 注册 webhook
- `GET /v1/webhook` - 获取 webhook 配置
- `POST /v1/test/send-message` - 测试消息推送

**验收标准**:
- [X] 可以接收私聊和群聊消息
- [X] 可以发送文本和图片消息
- [X] 消息格式与现有 OpenClaw 兼容

**Story 2 完成！** ✅

---

### Story 3: OpenClaw 插件改造

**优先级**: P0
**依赖**: Story 2
**预估工时**: 3-4 天

**描述**:
改造现有的 OpenClaw 微信插件，移除对第三方服务的依赖，改为调用本地 Bridge 服务。针对本地部署场景优化，webhookHost 默认使用 localhost。

**任务清单**:
1. 配置系统改造
   - [X] 移除 apiKey 配置项
   - [X] 移除 proxyUrl 配置项
   - [X] 添加 bridgeUrl 配置项（默认：http://localhost:3001）
   - [X] webhookHost 默认值改为 "localhost"（本地部署）
   - [X] 添加 puppet 配置项 (wechaty-puppet-wechat/padlocal)
   - [X] 更新配置校验逻辑

2. ProxyClient 替换
   - [X] 创建 BridgeClient 类
   - [X] 实现 Bridge API 调用方法
   - [X] 替换所有 ProxyClient 调用
   - [X] 保持 API 接口兼容性

3. 登录流程改造
   - [X] 修改二维码显示逻辑
   - [X] 修改登录状态检查逻辑
   - [ ] 支持自动重连（移至 Story 4）
   - [X] 移除 API Key 校验

4. 消息处理适配
   - [X] 保持消息处理逻辑不变
   - [X] 确保 webhook 接收正常（localhost 回调）
   - [X] 验证消息格式兼容性

**文件变更清单**:
- `src/types.ts` - 更新类型定义，移除 apiKey/proxyUrl，添加 bridgeUrl
- `src/channel.ts` - 修改配置解析，webhookHost 默认 localhost
- `src/proxy-client.ts` - 重命名为 bridge-client.ts 并重构
- `src/config-schema.ts` - 更新配置项，移除第三方服务依赖

**配置示例（本地部署）**:
```yaml
channels:
  wechat:
    enabled: true
    bridgeUrl: "http://localhost:3001"    # Bridge 本地地址
    webhookHost: "localhost"              # 本地部署使用 localhost
    webhookPort: 18790                    # 默认
    webhookPath: "/webhook/wechat"        # 默认
```

**验收标准**:
- [X] 插件可以正常启动
- [X] 配置系统正常工作（本地零配置）
- [X] 登录流程正常
- [X] 消息收发正常（通过 localhost）

**完成总结**:

Story 3 已完成！OpenClaw 插件已成功改造为使用本地 Bridge 服务。

**主要变更**:
1. **配置系统** (`src/config-schema.ts`, `src/types.ts`):
   - 移除了 `apiKey` 和 `proxyUrl` 配置项
   - 添加了 `bridgeUrl` 配置项，默认值为 `http://localhost:3001`
   - `webhookHost` 默认值改为 `localhost`，适配本地部署
   - Bridge 服务支持通过环境变量配置 `puppet` 类型

2. **BridgeClient 实现** (`src/bridge-client.ts`):
   - 创建了全新的 `BridgeClient` 类
   - 实现了与本地 Bridge 服务的 HTTP API 通信
   - 支持健康检查、登录流程、消息发送等功能
   - 完全兼容原 ProxyClient 的接口设计

3. **代码迁移** (`src/channel.ts`, `src/reply-dispatcher.ts`):
   - `channel.ts` 已完全使用 `BridgeClient`
   - `reply-dispatcher.ts` 已更新为使用 `BridgeClient`
   - 移除了对 `apiKey` 的依赖，改为通过 `account` 对象传递配置

4. **测试脚本更新** (`test-plugin.ts`):
   - 更新为测试 `BridgeClient` 而非 `ProxyClient`
   - 使用本地 Bridge 服务地址 (`http://localhost:3001`)

**本地部署配置示例**:
```yaml
channels:
  wechat:
    enabled: true
    bridgeUrl: "http://localhost:3001"    # Bridge 本地地址
    webhookHost: "localhost"              # 本地部署使用 localhost
    webhookPort: 18790                    # 默认
    webhookPath: "/webhook/wechat"        # 默认
```

**Story 3 完成！** 🎉

---

### Story 4: 会话保持与自动重连

**优先级**: P1
**依赖**: Story 3
**预估工时**: 2 天

**描述**:
实现会话保持机制，支持断线自动重连，提升稳定性。

**任务清单**:
1. 会话持久化
   - [ ] 实现 MemoryCard 存储
   - [ ] 配置会话文件路径
   - [ ] 实现会话恢复逻辑

2. 自动重连
   - [ ] 监听断线事件
   - [ ] 实现指数退避重试
   - [ ] 配置最大重试次数
   - [ ] 添加重连日志

3. 心跳检测
   - [ ] 实现定时心跳
   - [ ] 检测服务健康状态
   - [ ] 异常时触发重连

**验收标准**:
- 重启服务后可以自动恢复登录状态
- 断线后可以自动重连
- 心跳机制正常工作

---

### Story 5: 联系人管理

**优先级**: P2
**依赖**: Story 3
**预估工时**: 1-2 天

**描述**:
实现联系人列表获取功能，支持好友列表和群列表查询。

**任务清单**:
1. 获取通讯录
   - [ ] 实现 /v1/getAddressList 接口
   - [ ] 获取好友列表
   - [ ] 获取群列表
   - [ ] 获取群成员列表

2. 插件集成
   - [ ] 更新 directory.listPeers
   - [ ] 更新 directory.listGroups
   - [ ] 缓存联系人信息

**验收标准**:
- 可以获取好友列表
- 可以获取群列表
- 插件 directory 功能正常

---

### Story 6: 配置管理与部署

**优先级**: P1
**依赖**: Story 3
**预估工时**: 2 天

**描述**:
完善配置管理系统，提供部署文档和脚本。

**任务清单**:
1. 配置文件
   - [ ] 创建默认配置文件
   - [ ] 支持环境变量覆盖
   - [ ] 配置热更新

2. 启动脚本
   - [ ] 创建 start-bridge.sh
   - [ ] 创建 setup.sh
   - [ ] 创建 systemd 服务文件

3. Docker 支持
   - [ ] 创建 Dockerfile
   - [ ] 创建 docker-compose.yml
   - [ ] 编写部署文档

4. 文档
   - [ ] 更新 README.md
   - [ ] 创建配置指南
   - [ ] 创建部署指南

**验收标准**:
- 可以通过脚本一键启动
- Docker 部署正常工作
- 文档完整清晰

---

### Story 7: 测试与质量保障

**优先级**: P1
**依赖**: Story 3
**预估工时**: 3-4 天

**描述**:
建立完整的测试体系，确保代码质量。

**任务清单**:
1. 单元测试
   - [ ] 测试 WechatyClient 核心方法
   - [ ] 测试消息格式转换
   - [ ] 测试 Bridge API 路由
   - [ ] 测试配置解析

2. 集成测试
   - [ ] 测试完整登录流程
   - [ ] 测试消息收发流程
   - [ ] 测试错误处理

3. E2E 测试
   - [ ] 真实环境测试
   - [ ] 压力测试
   - [ ] 稳定性测试

4. 代码质量
   - [ ] 配置 ESLint
   - [ ] 配置 Prettier
   - [ ] 添加类型检查
   - [ ] 达到 80% 测试覆盖率

**验收标准**:
- 测试覆盖率 > 80%
- 所有测试通过
- CI/CD 流程配置完成

---

### Story 8: 日志与监控

**优先级**: P2
**依赖**: Story 3
**预估工时**: 1-2 天

**描述**:
完善日志系统和基础监控能力。

**任务清单**:
1. 日志系统
   - [ ] 统一日志格式
   - [ ] 配置日志级别
   - [ ] 日志文件轮转
   - [ ] 错误日志收集

2. 监控指标
   - [ ] 消息收发计数
   - [ ] 连接状态监控
   - [ ] 响应时间统计

3. 告警
   - [ ] 登录异常告警
   - [ ] 消息发送失败告警
   - [ ] 服务不可用告警

**验收标准**:
- 日志系统正常工作
- 关键指标可监控
- 异常可及时发现

---

## 实施顺序

```
Story 1: Bridge 服务基础框架
    │
    ▼
Story 2: 消息收发功能
    │
    ▼
Story 3: OpenClaw 插件改造 (核心里程碑)
    │
    ├──► Story 4: 会话保持与自动重连
    ├──► Story 5: 联系人管理
    ├──► Story 6: 配置管理与部署
    ├──► Story 7: 测试与质量保障
    └──► Story 8: 日志与监控
```

## 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| Wechaty 协议被封 | 高 | 中 | 使用 Puppet 隔离层，准备备选方案 |
| 微信账号被封 | 高 | 低 | 使用小号测试，控制消息频率 |
| 内存泄漏 | 中 | 中 | 定期重启机制，内存监控 |
| 消息丢失 | 中 | 低 | 本地消息持久化，消息确认机制 |

## 本地部署要求

### 核心要求
- ✅ **单机部署**：OpenClaw、Bridge、Wechaty 全部在同一台机器
- ✅ **无需公网 IP**：所有通信通过 localhost
- ✅ **最小配置**：仅需 `bridgeUrl`，其他使用默认值

### 默认配置
| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| bridgeUrl | http://localhost:3001 | Bridge 服务地址 |
| webhookHost | localhost | Webhook 回调地址 |
| webhookPort | 18790 | Webhook 端口 |
| webhookPath | /webhook/wechat | Webhook 路径 |
| puppet | wechaty-puppet-wechat | Wechaty 协议实现 |

## 成功指标

### 功能指标
- ✅ 支持私聊消息收发 ✓
- ✅ 支持群聊消息收发 ✓
- ✅ 支持文本消息 ✓
- ✅ 支持图片消息 ✓
- ✅ 支持二维码登录 ✓
- ✅ **本地零配置启动** ✓

### 性能指标
- 消息接收延迟 < 500ms
- 消息发送延迟 < 1s
- 支持并发处理 50 个群的消息

### 稳定性指标
- 服务可用性 > 99%
- 自动重连成功率 > 95%
- 消息不丢失

### 部署指标
- 本地部署配置项 <= 2 个
- 启动时间 < 30 秒
- 无需网络配置（防火墙例外）

## 下一步行动

1. **评审 Story 分解** - 确认范围和时间估算
2. **创建开发分支** - 基于 feature/wechaty-integration
3. **开始 Story 1 开发** - Bridge 服务基础框架
4. **定期同步进展** - 每 2 天同步一次开发状态

---

**文档版本**: 1.0  
**创建日期**: 2026-02-16  
**作者**: AI Assistant
