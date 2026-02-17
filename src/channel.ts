import type { ChannelPlugin, ClawdbotConfig } from 'openclaw/plugin-sdk';
import { DEFAULT_ACCOUNT_ID } from 'openclaw/plugin-sdk';
import type { ResolvedWeChatAccount, WechatConfig, WechatAccountConfig } from './types.js';
import { BridgeClient } from './bridge-client.js';
import { startCallbackServer } from './callback-server.js';
import { handleWeChatMessage } from './bot.js';
import { displayQRCode, displayLoginSuccess } from './utils/qrcode.js';

// Bridge 服务地址（本地部署，无需公网 IP）
// openclaw config set channels.wechat.bridgeUrl "http://localhost:3001"

const DEFAULT_BRIDGE_URL = 'http://localhost:3001';
const DEFAULT_WEBHOOK_HOST = 'localhost';
const DEFAULT_WEBHOOK_PORT = 18790;
const DEFAULT_WEBHOOK_PATH = '/webhook/wechat';

const PLUGIN_META = {
  id: 'openclaw-wechat',
  label: 'WeChat',
  selectionLabel: 'WeChat (微信) - 本地部署',
  docsPath: '/channels/wechat',
  docsLabel: 'wechat',
  blurb: 'WeChat channel via local Wechaty Bridge. 完全本地部署，无需购买 API Key',
  order: 80,
} as const;

/**
 * 解析微信账号配置
 * 支持简化配置（顶级字段）和多账号配置（accounts）
 */
async function resolveWeChatAccount({
  cfg,
  accountId,
}: {
  cfg: ClawdbotConfig;
  accountId: string;
}): Promise<ResolvedWeChatAccount> {
  console.log('[DEBUG] resolveWeChatAccount called, cfg.channels:', JSON.stringify(cfg.channels));
  const wechatCfg = cfg.channels?.['openclaw-wechat'] as WechatConfig | undefined;
  console.log('[DEBUG] wechatCfg:', JSON.stringify(wechatCfg));
  const isDefault = accountId === DEFAULT_ACCOUNT_ID;

  let accountCfg: WechatAccountConfig | undefined;
  let enabled: boolean;

  if (isDefault) {
    // 简化配置：从顶级字段读取，合并默认账号配置
    const topLevelConfig: WechatAccountConfig = {
      bridgeUrl: wechatCfg?.bridgeUrl || DEFAULT_BRIDGE_URL,
      webhookHost: wechatCfg?.webhookHost,
      webhookPort: wechatCfg?.webhookPort,
      webhookPath: wechatCfg?.webhookPath,
    };

    // 合并 accounts.default 配置（如果存在）
    const defaultAccount = wechatCfg?.accounts?.default;
    accountCfg = {
      ...topLevelConfig,
      ...defaultAccount,
      bridgeUrl: topLevelConfig.bridgeUrl || defaultAccount?.bridgeUrl || DEFAULT_BRIDGE_URL,
    };

    enabled = accountCfg.enabled ?? wechatCfg?.enabled ?? true;
  } else {
    accountCfg = wechatCfg?.accounts?.[accountId];
    enabled = accountCfg?.enabled ?? true;
  }

  if (!accountCfg?.bridgeUrl) {
    console.log('[DEBUG] bridgeUrl missing, using default:', DEFAULT_BRIDGE_URL);
    accountCfg = {
      bridgeUrl: DEFAULT_BRIDGE_URL,
      webhookHost: DEFAULT_WEBHOOK_HOST,
      webhookPort: DEFAULT_WEBHOOK_PORT,
      webhookPath: DEFAULT_WEBHOOK_PATH,
    };
  }

  return {
    accountId,
    enabled,
    configured: true,
    name: accountCfg.name,
    bridgeUrl: accountCfg.bridgeUrl,
    wcId: accountCfg.wcId,
    isLoggedIn: !!accountCfg.wcId,
    nickName: accountCfg.nickName,
    webhookHost: accountCfg.webhookHost || DEFAULT_WEBHOOK_HOST,
    webhookPort: accountCfg.webhookPort || DEFAULT_WEBHOOK_PORT,
    webhookPath: accountCfg.webhookPath || DEFAULT_WEBHOOK_PATH,
    natappEnabled: accountCfg.natappEnabled ?? false,
    natapiWebPort: accountCfg.natapiWebPort || 4040,
    config: accountCfg,
  };
}

/**
 * 列出所有可用的微信账号 ID
 * 支持简化配置和多账号配置
 */
function listWeChatAccountIds(cfg: ClawdbotConfig): string[] {
  const wechatCfg = cfg.channels?.['openclaw-wechat'] as WechatConfig | undefined;

  // 如果有顶级 bridgeUrl，则使用默认账号
  if (wechatCfg?.bridgeUrl) {
    return [DEFAULT_ACCOUNT_ID];
  }

  // 否则从 accounts 中读取
  const accounts = wechatCfg?.accounts;
  if (!accounts) return [];

  return Object.keys(accounts).filter((id) => accounts[id]?.enabled !== false);
}

export const wechatPlugin: ChannelPlugin<ResolvedWeChatAccount> = {
  id: 'openclaw-wechat',

  meta: PLUGIN_META,

  capabilities: {
    chatTypes: ['direct', 'channel'],
    polls: false,
    threads: false,
    media: true,
    reactions: false,
    edit: false,
    reply: false,
  },

  agentPrompt: {
    messageToolHints: () => [
      '- WeChat targeting: use `user:<wcId>` for direct messages, `group:<chatRoomId>` for groups.',
      '- WeChat supports text, image, and file messages.',
    ],
  },

  configSchema: {
    schema: {
      type: 'object' as const,
      additionalProperties: true,
      properties: {
        enabled: { type: 'boolean' },
        // 简化配置（顶级字段）
        bridgeUrl: { type: 'string' },
        webhookHost: { type: 'string' },
        webhookPort: { type: 'integer' },
        webhookPath: { type: 'string' },
        // 多账号配置
        // accounts: { ... } // Removed due to UI incompatibility
      },
    },
  },

  config: {
    listAccountIds: (cfg) => listWeChatAccountIds(cfg),

    resolveAccount: (cfg, accountId) => resolveWeChatAccount({ cfg, accountId }),

    defaultAccountId: (cfg) => {
      const ids = listWeChatAccountIds(cfg);
      return ids[0] || DEFAULT_ACCOUNT_ID;
    },

    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const wechatCfg = cfg.channels?.['openclaw-wechat'] as WechatConfig | undefined;
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        // 对于默认账号，设置顶级 enabled
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            wechat: {
              ...wechatCfg,
              enabled,
            },
          },
        };
      }

      const account = wechatCfg?.accounts?.[accountId];
      if (!account) {
        throw new Error(`Account ${accountId} not found`);
      }

      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          wechat: {
            ...wechatCfg,
            accounts: {
              ...wechatCfg?.accounts,
              [accountId]: {
                ...account,
                enabled,
              },
            },
          },
        },
      };
    },

    deleteAccount: ({ cfg, accountId }) => {
      const wechatCfg = cfg.channels?.['openclaw-wechat'] as WechatConfig | undefined;
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        // 删除整个 wechat 配置
        const next = { ...cfg } as ClawdbotConfig;
        const nextChannels = { ...cfg.channels };
        delete (nextChannels as Record<string, unknown>).wechat;
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next;
      }

      const accounts = { ...wechatCfg?.accounts };
      delete accounts[accountId];

      const nextCfg = { ...cfg } as ClawdbotConfig;
      nextCfg.channels = {
        ...cfg.channels,
        wechat: {
          ...wechatCfg,
          accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
        },
      };

      return nextCfg;
    },

    isConfigured: () => {
      // Always return true - the actual config validation happens in resolveAccount
      return true;
    },

    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name || account.nickName || account.accountId,
      wcId: account.wcId,
      isLoggedIn: account.isLoggedIn,
    }),

    resolveAllowFrom: ({ cfg, accountId }) => {
      // WeChat doesn't use allowlist in this MVP
      return [];
    },

    formatAllowFrom: ({ allowFrom }) => allowFrom.map(String),
  },

  security: {
    collectWarnings: ({ cfg, accountId }) => {
      // No specific security warnings for MVP
      return [];
    },
  },

  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,

    applyAccountConfig: ({ cfg, accountId }) => {
      const wechatCfg = cfg.channels?.['openclaw-wechat'] as WechatConfig | undefined;
      const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        // 对于默认账号，设置顶级 enabled
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            wechat: {
              ...wechatCfg,
              enabled: true,
            },
          },
        };
      }

      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          wechat: {
            ...wechatCfg,
            accounts: {
              ...wechatCfg?.accounts,
              [accountId]: {
                ...wechatCfg?.accounts?.[accountId],
                enabled: true,
              },
            },
          },
        },
      };
    },
  },

  messaging: {
    normalizeTarget: (target) => {
      if (target.startsWith('user:')) {
        return { type: 'direct', id: target.slice(5) };
      }
      if (target.startsWith('group:')) {
        return { type: 'channel', id: target.slice(6) };
      }
      // Assume direct message if no prefix
      return { type: 'direct', id: target };
    },

    targetResolver: {
      looksLikeId: (id) => {
        // wcId starts with wxid_ or is a chatroom ID
        return id.startsWith('wxid_') || id.includes('@chatroom');
      },
      hint: '<wxid_xxx|xxxx@chatroom|user:wxid_xxx|group:xxx@chatroom>',
    },
  },

  directory: {
    self: async () => null,

    listPeers: async ({ cfg, query, limit = 100, accountId }) => {
      const account = await resolveWeChatAccount({ cfg, accountId });
      if (!account.isLoggedIn) return [];

      const client = new BridgeClient({
        accountId,
        baseUrl: account.bridgeUrl,
      });

      try {
        const addressList = await client.getAddressList();

        let friends = addressList.friends;

        // 如果有查询条件，过滤联系人
        if (query) {
          const lowerQuery = query.toLowerCase();
          friends = friends.filter(
            (f) =>
              f.name.toLowerCase().includes(lowerQuery) ||
              f.alias?.toLowerCase().includes(lowerQuery) ||
              f.id.toLowerCase().includes(lowerQuery)
          );
        }

        return friends.slice(0, limit).map((friend) => ({
          id: friend.id,
          name: friend.alias || friend.name || friend.id,
          type: 'user' as const,
          avatar: friend.avatar,
        }));
      } catch (error: any) {
        console.warn('Failed to list peers:', error.message);
        return [];
      }
    },

    listGroups: async ({ cfg, query, limit = 50, accountId }) => {
      const account = await resolveWeChatAccount({ cfg, accountId });
      if (!account.isLoggedIn) return [];

      const client = new BridgeClient({
        accountId,
        baseUrl: account.bridgeUrl,
      });

      try {
        const addressList = await client.getAddressList();

        let chatrooms = addressList.chatrooms;

        // 如果有查询条件，过滤群
        if (query) {
          const lowerQuery = query.toLowerCase();
          chatrooms = chatrooms.filter(
            (r) =>
              r.name.toLowerCase().includes(lowerQuery) || r.id.toLowerCase().includes(lowerQuery)
          );
        }

        return chatrooms.slice(0, limit).map((room) => ({
          id: room.id,
          name: room.name || room.id,
          type: 'group' as const,
          memberCount: room.memberCount,
        }));
      } catch (error: any) {
        console.warn('Failed to list groups:', error.message);
        return [];
      }
    },

    listGroupMembers: async ({ cfg, groupId, accountId }) => {
      const account = await resolveWeChatAccount({ cfg, accountId });
      if (!account.isLoggedIn) return [];

      const client = new BridgeClient({
        accountId,
        baseUrl: account.bridgeUrl,
      });

      try {
        const members = await client.getRoomMembers(groupId);

        return members.map((member) => ({
          id: member.id,
          name: member.roomAlias || member.name || member.id,
          type: 'user' as const,
          avatar: member.avatar,
        }));
      } catch (error: any) {
        console.warn(`Failed to list members for group ${groupId}:`, error.message);
        return [];
      }
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      port: null,
    },

    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      port: snapshot.port ?? null,
    }),

    probeAccount: async ({ cfg, accountId }) => {
      const account = await resolveWeChatAccount({ cfg, accountId });
      const client = new BridgeClient({
        accountId,
        baseUrl: account.bridgeUrl,
      });

      try {
        const health = await client.healthCheck();
        return {
          ok: health.wechaty === 'ready' && health.loggedIn,
          error: health.wechaty !== 'ready' ? `Wechaty status: ${health.wechaty}` : undefined,
          wcId: undefined, // 需要额外获取
          nickName: undefined,
        };
      } catch (err: any) {
        return {
          ok: false,
          error: err.message,
        };
      }
    },

    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name || account.nickName,
      wcId: account.wcId,
      isLoggedIn: account.isLoggedIn,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const { cfg, accountId, abortSignal, setStatus, log } = ctx;
      const account = await resolveWeChatAccount({ cfg, accountId });

      log?.info(`Starting WeChat account: ${accountId}`);
      log?.info(`Bridge URL: ${account.bridgeUrl}`);

      const client = new BridgeClient({
        accountId,
        baseUrl: account.bridgeUrl,
      });

      // Check Bridge health
      let health;
      try {
        health = await client.healthCheck();
        log?.info(`Bridge health check: ${health.status}, Wechaty: ${health.wechaty}`);
      } catch (error: any) {
        throw new Error(`Bridge connection failed: ${error.message}`);
      }

      // If not logged in, perform QR code login
      if (!health.loggedIn) {
        log?.info('Not logged in, starting QR code login flow');

        const { qrCodeUrl } = await client.getQRCode();

        await displayQRCode(qrCodeUrl);
        log?.info('Please scan the QR code with WeChat to login');

        // Poll for login status
        let loggedIn = false;
        let loginResult: { wcId: string; nickName: string; headUrl?: string } | null = null;

        for (let i = 0; i < 60; i++) {
          if (abortSignal?.aborted) {
            throw new Error('Login aborted');
          }

          await new Promise((r) => setTimeout(r, 5000));

          const check = await client.checkLogin();

          if (check.status === 'logged_in') {
            loggedIn = true;
            loginResult = check;
            break;
          } else if (check.status === 'need_verify') {
            log?.warn(`Verification required: ${check.verifyUrl}`);
            console.log(`\n⚠️  需要辅助验证，请访问: ${check.verifyUrl}\n`);
          }
        }

        if (!loggedIn || !loginResult) {
          throw new Error('Login timeout: QR code expired');
        }

        displayLoginSuccess(loginResult.nickName, loginResult.wcId);

        log?.info(`Login successful: ${loginResult.nickName} (${loginResult.wcId})`);

        // Update local account object
        account.wcId = loginResult.wcId;
        account.nickName = loginResult.nickName;
        account.isLoggedIn = true;
      } else {
        log?.info(`Already logged in`);
        // Try to get user info from status
        const status = await client.checkLogin();
        if (status.status === 'logged_in') {
          account.wcId = status.wcId;
          account.nickName = status.nickName;
          account.isLoggedIn = true;
          log?.info(`User: ${status.nickName} (${status.wcId})`);
        }
      }

      // Start webhook server to receive messages
      const port = account.webhookPort;
      setStatus({ accountId, port, running: true });

      // Build webhook URL
      const webhookUrl = `http://${account.webhookHost}:${port}${account.webhookPath}`;
      log?.info(`Using webhook URL: ${webhookUrl}`);

      // Register webhook with Bridge
      log?.info(`Registering webhook with Bridge service`);
      await client.registerWebhook(webhookUrl);

      const { stop } = await startCallbackServer({
        port,
        onMessage: (message) => {
          handleWeChatMessage({
            cfg,
            message,
            runtime: ctx.runtime,
            accountId,
            account,
          }).catch((err) => {
            log?.error(`Failed to handle WeChat message: ${String(err)}`);
          });
        },
        abortSignal,
      });

      abortSignal?.addEventListener('abort', stop);

      log?.info(`WeChat account ${accountId} started successfully on port ${port}`);
      log?.info(`Webhook URL: ${webhookUrl}`);

      // Return a cleanup function
      return {
        async stop() {
          stop();
          setStatus({ accountId, port, running: false });
        },
      };
    },
  },

  outbound: {
    async sendText({ cfg, to, text, accountId }) {
      const account = await resolveWeChatAccount({ cfg, accountId });
      const client = new BridgeClient({
        accountId,
        baseUrl: account.bridgeUrl,
      });

      if (!account.wcId) {
        throw new Error('Not logged in');
      }

      const result = await client.sendText(to.id, text);

      return {
        channel: 'wechat',
        messageId: String(result.newMsgId),
        timestamp: result.createTime,
      };
    },

    async sendMedia({ cfg, to, mediaUrl, text, accountId }) {
      const account = await resolveWeChatAccount({ cfg, accountId });
      const client = new BridgeClient({
        accountId,
        baseUrl: account.bridgeUrl,
      });

      if (!account.wcId) {
        throw new Error('Not logged in');
      }

      // Send text first if provided
      if (text?.trim()) {
        await client.sendText(to.id, text);
      }

      // Send image
      const result = await client.sendImage(to.id, mediaUrl);

      return {
        channel: 'wechat',
        messageId: String(result.newMsgId),
      };
    },
  },
};
