import http from "http";
import type { WechatMessageContext } from "./types.js";

interface CallbackServerOptions {
  port: number;
  onMessage: (message: WechatMessageContext) => void;
  abortSignal?: AbortSignal;
}

export async function startCallbackServer(
  options: CallbackServerOptions
): Promise<{ port: number; stop: () => void }> {
  const { port, onMessage, abortSignal } = options;

  const server = http.createServer((req, res) => {
    // URL may include query params, so use startsWith
    const url = req.url?.split("?")[0] || "";
    if (url === "/webhook/wechat" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const message = convertToMessageContext(payload);

          if (message) {
            onMessage(message);
          }

          res.writeHead(200).end("OK");
        } catch (err) {
          console.error("Failed to process webhook:", err);
          res.writeHead(400).end("Bad Request");
        }
      });
    } else {
      res.writeHead(404).end("Not Found");
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "0.0.0.0", () => {
      console.log(`📡 Webhook server listening on 0.0.0.0:${port}`);
      console.log(`   Endpoint: http://localhost:${port}/webhook/wechat`);

      const stop = () => {
        server.close(() => {
          console.log(`📡 Webhook server on port ${port} stopped`);
        });
      };

      abortSignal?.addEventListener("abort", stop);

      resolve({ port, stop });
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Normalize the incoming payload into a flat shape.
 *
 * Bridge webhook payload format:
 * {
 *   id: string;
 *   type: "text" | "image" | "video" | "file" | "voice" | "unknown";
 *   sender: { id: string; name: string };
 *   recipient: { id: string };
 *   content: string;
 *   timestamp: number;
 *   isGroup: boolean;
 *   group?: { id: string; name: string };
 *   mentions?: string[];
 * }
 */
function normalizePayload(payload: any): {
  id: string;
  type: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  content: string;
  timestamp: number;
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  mentions?: string[];
  raw: any;
} {
  // Bridge format (new format)
  if (payload.sender && payload.recipient) {
    return {
      id: payload.id || String(Date.now()),
      type: payload.type || "unknown",
      senderId: payload.sender.id,
      senderName: payload.sender.name || payload.sender.id,
      recipientId: payload.recipient.id,
      content: payload.content || "",
      timestamp: payload.timestamp || Date.now(),
      isGroup: payload.isGroup || false,
      groupId: payload.group?.id,
      groupName: payload.group?.name,
      mentions: payload.mentions,
      raw: payload,
    };
  }

  // Legacy proxy format (for backward compatibility)
  // Proxy flat format: fromUser is at top level
  if (payload.fromUser) {
    const { messageType, wcId } = payload;
    const isGroup = messageType?.startsWith("8");
    
    return {
      id: String(payload.newMsgId || Date.now()),
      type: resolveMessageTypeFromCode(messageType),
      senderId: payload.fromUser,
      senderName: payload.fromUser,
      recipientId: wcId,
      content: payload.content ?? "",
      timestamp: payload.timestamp || Date.now(),
      isGroup,
      groupId: payload.fromGroup,
      raw: payload,
    };
  }

  // 苍何服务云 raw format: fields nested under data
  const data = payload.data ?? {};
  const messageType = payload.messageType;
  const isGroup = messageType?.startsWith("8");
  
  return {
    id: String(data.newMsgId || Date.now()),
    type: resolveMessageTypeFromCode(messageType),
    senderId: data.fromUser,
    senderName: data.fromUser,
    recipientId: payload.wcId,
    content: data.content ?? "",
    timestamp: data.timestamp ?? payload.timestamp ?? Date.now(),
    isGroup,
    groupId: data.fromGroup,
    raw: payload,
  };
}

/** Map messageType code to a WechatMessageContext type */
function resolveMessageTypeFromCode(messageType: string): string {
  switch (messageType) {
    case "60001": // private text
    case "80001": // group text
      return "text";
    case "60002": // private image
    case "80002": // group image
      return "image";
    case "60003": // private video
    case "80003": // group video
      return "video";
    case "60004": // private voice
    case "80004": // group voice
      return "voice";
    case "60008": // private file
    case "80008": // group file
      return "file";
    default:
      return "unknown";
  }
}

function convertToMessageContext(payload: any): WechatMessageContext | null {
  // Legacy: Offline notification
  if (payload.messageType === "30000") {
    const wcId = payload.wcId;
    const offlineContent = payload.content ?? payload.data?.content;
    console.log(`Account ${wcId} is offline: ${offlineContent}`);
    return null;
  }

  const norm = normalizePayload(payload);

  if (!norm.senderId) {
    console.log(`Message missing senderId, skipping`);
    return null;
  }

  const result: WechatMessageContext = {
    id: norm.id,
    type: norm.type as WechatMessageContext["type"],
    sender: {
      id: norm.senderId,
      name: norm.senderName,
    },
    recipient: {
      id: norm.recipientId,
    },
    content: norm.content,
    timestamp: norm.timestamp,
    threadId: norm.isGroup ? (norm.groupId || norm.senderId) : norm.senderId,
    raw: norm.raw,
  };

  if (norm.isGroup && norm.groupId) {
    result.group = {
      id: norm.groupId,
      name: norm.groupName || "",
    };
  }

  return result;
}
