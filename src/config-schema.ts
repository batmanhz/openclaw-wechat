/**
 * Configuration types for WeChat channel
 * 支持简化配置（顶级字段）和多账号配置（accounts）
 * Note: Zod is available from OpenClaw runtime for validation
 */

export interface WechatAccountConfig {
  enabled?: boolean;
  name?: string;
  bridgeUrl: string;       // Bridge 服务地址（必须）
  webhookHost?: string;    // Webhook 地址（默认 localhost）
  webhookPort?: number;    // Webhook 端口（默认 18790）
  webhookPath?: string;    // Webhook 路径，默认 /webhook/wechat
  natappEnabled?: boolean;
  natapiWebPort?: number;
  wcId?: string;           // 登录后自动填充
  nickName?: string;       // 登录后自动填充
  configured?: boolean;    // 运行时标记
}

export interface WechatConfig {
  enabled?: boolean;

  // 简化配置（单账号，顶级字段）
  bridgeUrl?: string;      // Bridge 服务地址（默认 http://localhost:3001）
  webhookHost?: string;    // Webhook 地址（默认 localhost）
  webhookPort?: number;    // Webhook 端口
  webhookPath?: string;    // Webhook 路径

  // 多账号配置（可选）
  accounts?: Record<string, WechatAccountConfig | undefined>;
}

// Schema object for OpenClaw config validation
export const WechatConfigSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },

    // 简化配置（顶级字段）
    bridgeUrl: { type: "string" },
    webhookHost: { type: "string" },
    webhookPort: { type: "integer" },
    webhookPath: { type: "string" },

    // 多账号配置
    accounts: {
      type: "object" as const,
      additionalProperties: {
        type: "object" as const,
        additionalProperties: true,
        properties: {
          enabled: { type: "boolean" },
          name: { type: "string" },
          bridgeUrl: { type: "string" },
          webhookHost: { type: "string" },
          webhookPort: { type: "integer" },
          webhookPath: { type: "string" },
          natappEnabled: { type: "boolean" },
          natapiWebPort: { type: "integer" },
          wcId: { type: "string" },
          nickName: { type: "string" },
        },
        required: ["bridgeUrl"],
      },
    },
  },
};
