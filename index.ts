import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { wechatPlugin } from './src/channel.js';
import { setWeChatRuntime } from './src/runtime.js';

const plugin = {
  id: 'openclaw-wechat',
  name: 'WeChat',
  description: 'WeChat channel via Proxy API',
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    setWeChatRuntime(api.runtime);
    api.registerChannel({ plugin: wechatPlugin });
    console.log('WeChat channel plugin registered');
  },
};

export default plugin;
export { wechatPlugin } from './src/channel.js';
export type { WechatConfig, WechatAccountConfig, ResolvedWeChatAccount } from './src/types.js';
