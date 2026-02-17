import type { WechatAccountConfig, WechatConfig } from "./config-schema.js";

// Re-export for convenience
export type { WechatConfig, WechatAccountConfig };

export type ResolvedWeChatAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  bridgeUrl: string;       // Bridge 服务地址
  wcId?: string;
  isLoggedIn: boolean;
  nickName?: string;
  headUrl?: string;
  webhookHost?: string;    // Webhook 地址（默认 localhost）
  webhookPort: number;
  webhookPath: string;     // Webhook 路径
  natappEnabled: boolean;
  natapiWebPort: number;
  config: WechatAccountConfig;
};

export type LoginStatus =
  | { status: "waiting" }
  | { status: "need_verify"; verifyUrl: string }
  | { status: "logged_in"; wcId: string; nickName: string; headUrl?: string };

export type BridgeClientConfig = {
  accountId: string;
  baseUrl: string;
};

export type WechatMessageContext = {
  id: string;
  type: "text" | "image" | "video" | "file" | "voice" | "unknown";
  sender: {
    id: string;
    name: string;
  };
  recipient: {
    id: string;
  };
  content: string;
  timestamp: number;
  threadId: string;
  group?: {
    id: string;
    name: string;
  };
  raw: any;
};
