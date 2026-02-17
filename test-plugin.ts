/**
 * 插件本地测试脚本 - 测试 BridgeClient 和本地 Bridge 服务
 */

import { BridgeClient } from "./src/bridge-client.js";
import { startCallbackServer } from "./src/callback-server.js";

// ===== 测试配置 =====
const TEST_CONFIG = {
  accountId: "default",
  bridgeUrl: "http://localhost:3001", // 本地 Bridge 服务地址
};

// ===== 测试 1: BridgeClient =====
async function testBridgeClient() {
  console.log("\n🧪 测试 BridgeClient...");

  const client = new BridgeClient({
    accountId: TEST_CONFIG.accountId,
    baseUrl: TEST_CONFIG.bridgeUrl,
  });

  try {
    // 测试健康检查
    console.log("  - 测试 healthCheck()");
    const health = await client.healthCheck();
    console.log("  ✓ Health:", health);
  } catch (err: any) {
    console.log("  ✗ healthCheck 失败:", err.message);
  }

  try {
    // 测试获取状态
    console.log("  - 测试 getStatus()");
    const status = await client.getStatus();
    console.log("  ✓ Status:", status);
  } catch (err: any) {
    console.log("  ✗ getStatus 失败:", err.message);
  }

  try {
    // 测试获取二维码
    console.log("  - 测试 getQRCode()");
    const qr = await client.getQRCode();
    console.log("  ✓ QRCode:", qr);
  } catch (err: any) {
    console.log("  ✗ getQRCode 失败:", err.message);
  }

  try {
    // 测试检查登录状态
    console.log("  - 测试 checkLogin()");
    const loginStatus = await client.checkLogin();
    console.log("  ✓ Login Status:", loginStatus);
  } catch (err: any) {
    console.log("  ✗ checkLogin 失败:", err.message);
  }
}

// ===== 测试 2: Callback Server =====
async function testCallbackServer() {
  console.log("\n🧪 测试 CallbackServer...");

  try {
    const { stop } = await startCallbackServer({
      port: 18790,
      onMessage: (message) => {
        console.log("  📩 收到消息:", message);
      },
    });

    console.log(`  ✓ 服务器启动在端口 18790`);

    // 5秒后停止
    setTimeout(() => {
      stop();
      console.log("  ✓ 服务器已停止");
    }, 5000);
  } catch (err: any) {
    console.log("  ✗ 启动失败:", err.message);
  }
}

// ===== 测试 3: 模拟消息接收 =====
async function testWebhookReceive() {
  console.log("\n🧪 测试 Webhook 接收...");

  // 模拟发送一个 webhook 请求到本地服务器
  const testPayload = {
    messageType: "60001",
    wcId: "wxid_test123",
    timestamp: Date.now(),
    data: {
      newMsgId: 123456789,
      fromUser: "wxid_fromuser",
      content: "测试消息",
      timestamp: Date.now(),
    },
  };

  try {
    const response = await fetch("http://localhost:18790/webhook/wechat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
    });

    console.log("  ✓ Webhook 响应:", response.status);
  } catch (err: any) {
    console.log("  ✗ Webhook 请求失败:", err.message);
  }
}

// ===== 测试 4: 注册 Webhook =====
async function testRegisterWebhook() {
  console.log("\n🧪 测试注册 Webhook...");

  const client = new BridgeClient({
    accountId: TEST_CONFIG.accountId,
    baseUrl: TEST_CONFIG.bridgeUrl,
  });

  try {
    const webhookUrl = "http://localhost:18790/webhook/wechat";
    await client.registerWebhook(webhookUrl);
    console.log("  ✓ Webhook 注册成功:", webhookUrl);
  } catch (err: any) {
    console.log("  ✗ Webhook 注册失败:", err.message);
  }
}

// ===== 主测试流程 =====
async function main() {
  console.log("🚀 开始插件本地测试（Bridge 模式）\n");
  console.log("配置:", TEST_CONFIG);

  // 测试 BridgeClient
  await testBridgeClient();

  // 测试注册 Webhook
  await testRegisterWebhook();

  // 测试 CallbackServer
  await testCallbackServer();

  // 等待服务器启动
  await new Promise((r) => setTimeout(r, 1000));

  // 测试 Webhook 接收
  await testWebhookReceive();

  console.log("\n✅ 测试完成");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试失败:", err);
  process.exit(1);
});
