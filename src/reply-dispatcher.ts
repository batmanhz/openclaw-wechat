import type {
  ClawdbotConfig,
  RuntimeEnv,
  ReplyPayload,
} from "openclaw/plugin-sdk";
import { createReplyPrefixContext } from "openclaw/plugin-sdk";
import { getWeChatRuntime } from "./runtime.js";
import { BridgeClient } from "./bridge-client.js";
import type { ResolvedWeChatAccount } from "./types.js";

export type CreateWeChatReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  account: ResolvedWeChatAccount;
  /** The wcId to send replies to (sender or group) */
  replyTo: string;
};

export function createWeChatReplyDispatcher(params: CreateWeChatReplyDispatcherParams) {
  const core = getWeChatRuntime();
  const { cfg, agentId, runtime, account, replyTo } = params;
  const accountId = account.accountId;

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: "wechat",
    defaultLimit: 2000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "wechat");

  const client = new BridgeClient({ 
    accountId, 
    baseUrl: account.bridgeUrl 
  });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      deliver: async (payload: ReplyPayload) => {
        runtime.log?.(`wechat[${accountId}] deliver called: text=${payload.text?.slice(0, 100)}`);
        const text = payload.text ?? "";
        if (!text.trim()) {
          runtime.log?.(`wechat[${accountId}] deliver: empty text, skipping`);
          return;
        }

        const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
        runtime.log?.(`wechat[${accountId}] deliver: sending ${chunks.length} chunks to ${replyTo}`);

        for (const chunk of chunks) {
          try {
            const result = await client.sendText(replyTo, chunk);
            runtime.log?.(`wechat[${accountId}] sendText success: msgId=${result.msgId}`);
          } catch (err) {
            runtime.error?.(`wechat[${accountId}] sendText failed: ${String(err)}`);
            throw err;
          }
        }
      },
      onError: (err, info) => {
        runtime.error?.(`wechat[${accountId}] ${info.kind} reply failed: ${String(err)}`);
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}
