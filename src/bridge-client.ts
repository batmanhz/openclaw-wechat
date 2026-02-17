export interface BridgeClientConfig {
  baseUrl: string;
  accountId: string;
}

export type LoginStatus =
  | { status: 'waiting' }
  | { status: 'need_verify'; verifyUrl: string }
  | { status: 'logged_in'; wcId: string; nickName: string; headUrl?: string };

export class BridgeClient {
  private accountId: string;
  readonly baseUrl: string;

  constructor(config: BridgeClientConfig) {
    this.accountId = config.accountId;
    if (!config.baseUrl) {
      throw new Error(
        'bridgeUrl is required. Please configure it with: openclaw config set channels.wechat.bridgeUrl "http://localhost:3001"'
      );
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  private async request(
    endpoint: string,
    data?: unknown,
    method: 'GET' | 'POST' = 'POST'
  ): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Account-ID': this.accountId,
      },
      body: method === 'POST' && data ? JSON.stringify(data) : undefined,
    });

    const result = (await response.json().catch(() => ({
      success: false,
      error: `HTTP ${response.status}: ${response.statusText}`,
    }))) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        (result.error as string) ||
          (result.message as string) ||
          `Request failed: ${response.status}`
      );
    }

    // Bridge 服务返回格式: { success: boolean, error?: string, ... }
    if (result.error) {
      throw new Error(result.error as string);
    }

    return result;
  }

  // ===== Health Check =====

  async healthCheck(): Promise<{
    status: string;
    wechaty: string;
    loggedIn: boolean;
  }> {
    const result = (await this.request('/health', undefined, 'GET')) as {
      status: string;
      wechaty: string;
      loggedIn: boolean;
    };
    return result;
  }

  // ===== Account Status =====

  async getStatus(): Promise<{
    valid: boolean;
    wcId?: string;
    isLoggedIn: boolean;
    nickName?: string;
    error?: string;
  }> {
    try {
      const health = await this.healthCheck();

      if (health.wechaty === 'ready' && health.loggedIn) {
        // 如果 Wechaty 已就绪且已登录，需要获取用户信息
        // Bridge 的 /health 端点可能包含用户信息，或通过其他方式获取
        // 这里我们假设 health 端点返回 loggedIn 状态
        // 实际 wcId 和 nickName 可能需要额外获取或存储
        return {
          valid: true,
          isLoggedIn: true,
          // wcId 和 nickName 会在登录流程后从 login result 中获取
        };
      }

      return {
        valid: true,
        isLoggedIn: false,
      };
    } catch (error: any) {
      return {
        valid: false,
        isLoggedIn: false,
        error: error.message,
      };
    }
  }

  // ===== Login Flow =====

  async getQRCode(): Promise<{
    qrCodeUrl: string;
    wId: string;
  }> {
    const result = (await this.request('/v1/iPadLogin', {})) as {
      success: boolean;
      qrCodeUrl?: string;
      qrCode?: string;
      error?: string;
    };

    if (!result.success || !(result.qrCodeUrl || result.qrCode)) {
      throw new Error(result.error || 'Failed to get QR code');
    }

    return {
      wId: 'wechaty',
      qrCodeUrl: result.qrCodeUrl || result.qrCode || '',
    };
  }

  async checkLogin(): Promise<LoginStatus> {
    try {
      const result = (await this.request('/v1/account/status', undefined, 'GET')) as {
        success: boolean;
        loggedIn: boolean;
        userInfo?: {
          id: string;
          name: string;
          avatar?: string;
        };
        error?: string;
      };

      if (result.success && result.loggedIn && result.userInfo) {
        return {
          status: 'logged_in',
          wcId: result.userInfo.id,
          nickName: result.userInfo.name,
          headUrl: result.userInfo.avatar,
        };
      }

      // 检查是否还在等待登录
      const health = await this.healthCheck();
      if (health.wechaty === 'pending_scan' || health.wechaty === 'pending_login') {
        return { status: 'waiting' };
      }

      return { status: 'waiting' };
    } catch (error: any) {
      return { status: 'waiting' };
    }
  }

  // ===== Message Sending =====

  async sendText(
    wcId: string,
    content: string
  ): Promise<{
    msgId: number;
    newMsgId: number;
    createTime: number;
  }> {
    const result = (await this.request('/v1/sendText', {
      wcId,
      content,
    })) as {
      code?: string;
      data?: {
        msgId: number;
        newMsgId: number;
        createTime: number;
      };
      message?: string;
    };

    // Bridge 返回格式: { code: "1000", data: {...} }
    if (result.code !== '1000' || !result.data) {
      throw new Error(result.message || 'Failed to send text message');
    }

    return result.data;
  }

  async sendImage(
    wcId: string,
    imageUrl: string
  ): Promise<{
    msgId: number;
    newMsgId: number;
    createTime: number;
  }> {
    const result = (await this.request('/v1/sendImage2', {
      wcId,
      imageUrl,
    })) as {
      success: boolean;
      messageId?: string;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'Failed to send image message');
    }

    const now = Date.now();
    return {
      msgId: now,
      newMsgId: now,
      createTime: Math.floor(now / 1000),
    };
  }

  // ===== Contacts =====

  async getContacts(): Promise<{
    friends: string[];
    chatrooms: string[];
  }> {
    try {
      const result = (await this.request('/v1/getAddressList', {})) as {
        code: string;
        data: {
          friends: Array<{ id: string; name: string }>;
          chatrooms: Array<{ id: string; name: string }>;
        };
      };

      if (result.code !== '1000' || !result.data) {
        return { friends: [], chatrooms: [] };
      }

      return {
        friends: result.data.friends.map((f) => f.id),
        chatrooms: result.data.chatrooms.map((r) => r.id),
      };
    } catch (error: any) {
      console.warn('Failed to get contacts:', error.message);
      return { friends: [], chatrooms: [] };
    }
  }

  /**
   * Get detailed address list with friend and room info
   */
  async getAddressList(forceRefresh: boolean = false): Promise<{
    friends: Array<{ id: string; name: string; avatar?: string; alias?: string }>;
    chatrooms: Array<{ id: string; name: string; memberCount?: number }>;
    updateTime: number;
  }> {
    const result = (await this.request('/v1/getAddressList', { forceRefresh })) as {
      code: string;
      data: {
        friends: Array<{ id: string; name: string; avatar?: string; alias?: string }>;
        chatrooms: Array<{ id: string; name: string; memberCount?: number }>;
        updateTime: number;
      };
    };

    if (result.code !== '1000') {
      throw new Error('Failed to get address list');
    }

    return result.data;
  }

  /**
   * Get room members
   */
  async getRoomMembers(roomId: string): Promise<
    Array<{
      id: string;
      name: string;
      avatar?: string;
      roomAlias?: string;
    }>
  > {
    const result = (await this.request('/v1/getRoomMembers', { roomId })) as {
      code: string;
      data: {
        roomId: string;
        members: Array<{
          id: string;
          name: string;
          avatar?: string;
          roomAlias?: string;
        }>;
      };
    };

    if (result.code !== '1000') {
      throw new Error('Failed to get room members');
    }

    return result.data.members;
  }

  // ===== Webhook =====

  /**
   * Register plugin webhook URL with Bridge.
   * Bridge will forward messages from Wechaty to this URL.
   */
  async registerWebhook(webhookUrl: string): Promise<void> {
    const result = (await this.request('/v1/webhook/register', {
      webhookUrl,
    })) as {
      success: boolean;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'Failed to register webhook');
    }
  }

  /**
   * Get current webhook configuration
   */
  async getWebhook(): Promise<{
    url: string | null;
  }> {
    const result = (await this.request('/v1/webhook/get', {})) as {
      success: boolean;
      webhookUrl?: string | null;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'Failed to get webhook configuration');
    }

    return {
      url: result.webhookUrl || null,
    };
  }
}
