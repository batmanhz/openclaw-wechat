import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { getWeChatRuntime } from "./runtime.js";
import { createWeChatReplyDispatcher } from "./reply-dispatcher.js";
import type { WechatMessageContext, ResolvedWeChatAccount } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Save base64 image to temp file and return path
async function saveBase64ImageToTemp(base64Data: string): Promise<string> {
  // Extract mime type and base64 content
  const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid base64 image data");
  }
  
  const mimeType = match[1];
  const base64Content = match[2];
  
  // Determine file extension
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const tempDir = path.join(os.tmpdir(), "openclaw-wechat-images");
  
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const tempPath = path.join(tempDir, `img-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  
  // Write file
  const buffer = Buffer.from(base64Content, "base64");
  fs.writeFileSync(tempPath, buffer);
  
  return tempPath;
}

// Download image from HTTP URL to temp file
async function downloadImageToTemp(imageUrl: string): Promise<string> {
  const tempDir = path.join(os.tmpdir(), "openclaw-wechat-images");
  
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const tempPath = path.join(tempDir, `img-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  
  // Download image using fetch
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tempPath, buffer);
  
  return tempPath;
}

// --- Message deduplication ---
const processedMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const DEDUP_MAX_SIZE = 1000;
const DEDUP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let lastCleanup = Date.now();

function tryRecordMessage(messageId: string): boolean {
  const now = Date.now();

  // Periodic cleanup
  if (now - lastCleanup > DEDUP_CLEANUP_INTERVAL_MS) {
    lastCleanup = now;
    for (const [id, ts] of processedMessages) {
      if (now - ts > DEDUP_WINDOW_MS) processedMessages.delete(id);
    }
  }

  // Evict oldest if at capacity
  if (processedMessages.size >= DEDUP_MAX_SIZE) {
    const oldest = processedMessages.keys().next().value;
    if (oldest) processedMessages.delete(oldest);
  }

  if (processedMessages.has(messageId)) return false;
  processedMessages.set(messageId, now);
  return true;
}

export async function handleWeChatMessage(params: {
  cfg: ClawdbotConfig;
  message: WechatMessageContext;
  runtime?: RuntimeEnv;
  accountId?: string;
  account: ResolvedWeChatAccount;
}): Promise<void> {
  const { cfg, message, runtime, accountId, account } = params;

  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  // Dedup check
  if (!tryRecordMessage(message.id)) {
    log(`wechat: skipping duplicate message ${message.id}`);
    return;
  }

  const isGroup = !!message.group;

  log(`wechat[${accountId}]: received ${message.type} from ${message.sender.id}${isGroup ? ` in group ${message.group!.id}` : ""}`);

  // Handle text and image messages
  if (message.type !== "text" && message.type !== "image") {
    log(`wechat[${accountId}]: ignoring non-text/image message type: ${message.type}`);
    return;
  }

  try {
    const core = getWeChatRuntime();

    const wechatFrom = `wechat:${message.sender.id}`;
    const wechatTo = isGroup
      ? `group:${message.group!.id}`
      : `user:${message.sender.id}`;

    const peerId = isGroup ? message.group!.id : message.sender.id;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "wechat",
      accountId: account.accountId,
      peer: {
        kind: isGroup ? "group" : "direct",
        id: peerId,
      },
    });

    const preview = message.content.replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isGroup
      ? `WeChat[${accountId}] message in group ${message.group!.id}`
      : `WeChat[${accountId}] DM from ${message.sender.id}`;

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `wechat:message:${peerId}:${message.id}`,
    });

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    // Build message body with speaker attribution
    const speaker = message.sender.name || message.sender.id;
    const messageBody = message.type === "image" 
      ? `${speaker}: [图片]` 
      : `${speaker}: ${message.content}`;

    const envelopeFrom = isGroup
      ? `${message.group!.id}:${message.sender.id}`
      : message.sender.id;

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "WeChat",
      from: envelopeFrom,
      timestamp: new Date(message.timestamp),
      envelope: envelopeOptions,
      body: messageBody,
    });

    const ctxBase: any = {
      Body: body,
      RawBody: message.content,
      CommandBody: message.content,
      From: wechatFrom,
      To: wechatTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? message.group!.id : undefined,
      SenderName: message.sender.name || message.sender.id,
      SenderId: message.sender.id,
      Provider: "wechat" as const,
      Surface: "wechat" as const,
      MessageSid: message.id,
      Timestamp: Date.now(),
      WasMentioned: false,
      CommandAuthorized: true,
      OriginatingChannel: "wechat" as const,
      OriginatingTo: wechatTo,
    };

    // 处理图片消息 - 保存为临时文件并使用 MediaPaths
    if (message.type === "image" && message.imageUrl) {
      try {
        let tempPath: string;
        
        // 根据 imageUrl 格式选择处理方式
        if (message.imageUrl.startsWith("data:")) {
          // Base64 格式
          tempPath = await saveBase64ImageToTemp(message.imageUrl);
        } else if (message.imageUrl.startsWith("http://") || message.imageUrl.startsWith("https://")) {
          // HTTP URL 格式
          tempPath = await downloadImageToTemp(message.imageUrl);
        } else if (message.imageUrl.startsWith("/") && fs.existsSync(message.imageUrl)) {
          // 本地文件路径 - 直接使用
          tempPath = message.imageUrl;
          log(`wechat[${accountId}]: using local file path: ${tempPath}`);
        } else {
          throw new Error(`Unsupported image URL format: ${message.imageUrl.substring(0, 50)}...`);
        }
        
        ctxBase.MediaPaths = [tempPath];
        ctxBase.MediaTypes = ["image/jpeg"];
        log(`wechat[${accountId}]: saved image to temp file: ${tempPath}`);
      } catch (e) {
        log(`wechat[${accountId}]: failed to save image: ${e}`);
      }
    }

    const ctxPayload = core.channel.reply.finalizeInboundContext(ctxBase);

    // Determine reply target: in groups reply to group, in DMs reply to sender
    const replyTo = isGroup ? message.group!.id : message.sender.id;

    const { dispatcher, replyOptions, markDispatchIdle } = createWeChatReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      account,
      replyTo,
    });

    log(`wechat[${accountId}]: dispatching to agent (session=${route.sessionKey})`);

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    log(`wechat[${accountId}]: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
  } catch (err) {
    error(`wechat[${accountId}]: failed to dispatch message: ${String(err)}`);
  }
}
