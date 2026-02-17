/**
 * 监控指标收集器
 * 用于收集和统计关键性能指标
 */

export interface MetricsSnapshot {
  timestamp: number;
  messages: {
    received: number;
    sent: number;
    failed: number;
    receivedPerMinute: number;
    sentPerMinute: number;
  };
  connections: {
    status: 'connected' | 'disconnected' | 'reconnecting';
    loginTime: number | null;
    disconnectCount: number;
    reconnectAttempts: number;
  };
  performance: {
    avgResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
    requestCount: number;
  };
  webhooks: {
    sent: number;
    failed: number;
    avgLatency: number;
  };
}

/**
 * 监控指标收集器类
 */
export class MetricsCollector {
  // 消息统计
  private messagesReceived: number = 0;
  private messagesSent: number = 0;
  private messagesFailed: number = 0;
  private messageHistory: { type: 'received' | 'sent'; timestamp: number }[] = [];

  // 连接状态
  private connectionStatus: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
  private loginTime: number | null = null;
  private disconnectCount: number = 0;
  private reconnectAttempts: number = 0;

  // 性能统计
  private responseTimes: number[] = [];
  private maxResponseTime: number = 0;
  private minResponseTime: number = Infinity;

  // Webhook 统计
  private webhooksSent: number = 0;
  private webhooksFailed: number = 0;
  private webhookLatencies: number[] = [];

  // 告警回调
  private alertCallbacks: Array<(type: string, message: string, data?: any) => void> = [];

  /**
   * 记录消息接收
   */
  recordMessageReceived(): void {
    this.messagesReceived++;
    this.messageHistory.push({ type: 'received', timestamp: Date.now() });
    this.cleanupMessageHistory();
  }

  /**
   * 记录消息发送
   */
  recordMessageSent(): void {
    this.messagesSent++;
    this.messageHistory.push({ type: 'sent', timestamp: Date.now() });
    this.cleanupMessageHistory();
  }

  /**
   * 记录消息发送失败
   */
  recordMessageFailed(error?: Error): void {
    this.messagesFailed++;
    this.triggerAlert('message_failed', 'Message sending failed', { error: error?.message });
  }

  /**
   * 清理历史消息记录（保留最近1小时）
   */
  private cleanupMessageHistory(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.messageHistory = this.messageHistory.filter(m => m.timestamp > oneHourAgo);
  }

  /**
   * 设置连接状态
   */
  setConnectionStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
    const oldStatus = this.connectionStatus;
    this.connectionStatus = status;

    if (status === 'connected') {
      this.loginTime = Date.now();
      this.reconnectAttempts = 0;
    } else if (status === 'disconnected' && oldStatus === 'connected') {
      this.disconnectCount++;
    }

    if (status === 'disconnected') {
      this.triggerAlert('connection_lost', 'Connection to WeChat lost', { previousStatus: oldStatus });
    }
  }

  /**
   * 记录重连尝试
   */
  recordReconnectAttempt(): void {
    this.reconnectAttempts++;
    if (this.reconnectAttempts >= 5) {
      this.triggerAlert('reconnect_failed', `Failed to reconnect after ${this.reconnectAttempts} attempts`, {
        attempts: this.reconnectAttempts,
      });
    }
  }

  /**
   * 记录响应时间
   */
  recordResponseTime(duration: number): void {
    this.responseTimes.push(duration);
    if (duration > this.maxResponseTime) {
      this.maxResponseTime = duration;
    }
    if (duration < this.minResponseTime) {
      this.minResponseTime = duration;
    }

    // 保留最近1000条记录
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }

    // 告警：响应时间过长
    if (duration > 5000) {
      this.triggerAlert('slow_response', `Slow response detected: ${duration}ms`, { duration });
    }
  }

  /**
   * 记录 Webhook 发送
   */
  recordWebhookSent(latency: number): void {
    this.webhooksSent++;
    this.webhookLatencies.push(latency);

    if (this.webhookLatencies.length > 1000) {
      this.webhookLatencies.shift();
    }
  }

  /**
   * 记录 Webhook 失败
   */
  recordWebhookFailed(error?: Error): void {
    this.webhooksFailed++;
    this.triggerAlert('webhook_failed', 'Webhook delivery failed', { error: error?.message });
  }

  /**
   * 获取指标快照
   */
  getSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    // 计算最近1分钟的消息速率
    const recentMessages = this.messageHistory.filter(m => m.timestamp > oneMinuteAgo);
    const receivedPerMinute = recentMessages.filter(m => m.type === 'received').length;
    const sentPerMinute = recentMessages.filter(m => m.type === 'sent').length;

    // 计算平均响应时间
    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    // 计算平均 Webhook 延迟
    const avgWebhookLatency = this.webhookLatencies.length > 0
      ? this.webhookLatencies.reduce((a, b) => a + b, 0) / this.webhookLatencies.length
      : 0;

    return {
      timestamp: now,
      messages: {
        received: this.messagesReceived,
        sent: this.messagesSent,
        failed: this.messagesFailed,
        receivedPerMinute,
        sentPerMinute,
      },
      connections: {
        status: this.connectionStatus,
        loginTime: this.loginTime,
        disconnectCount: this.disconnectCount,
        reconnectAttempts: this.reconnectAttempts,
      },
      performance: {
        avgResponseTime: Math.round(avgResponseTime),
        maxResponseTime: this.maxResponseTime,
        minResponseTime: this.minResponseTime === Infinity ? 0 : this.minResponseTime,
        requestCount: this.responseTimes.length,
      },
      webhooks: {
        sent: this.webhooksSent,
        failed: this.webhooksFailed,
        avgLatency: Math.round(avgWebhookLatency),
      },
    };
  }

  /**
   * 注册告警回调
   */
  onAlert(callback: (type: string, message: string, data?: any) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * 触发告警
   */
  private triggerAlert(type: string, message: string, data?: any): void {
    this.alertCallbacks.forEach(callback => {
      try {
        callback(type, message, data);
      } catch (error) {
        console.error('Alert callback failed:', error);
      }
    });
  }

  /**
   * 重置指标
   */
  reset(): void {
    this.messagesReceived = 0;
    this.messagesSent = 0;
    this.messagesFailed = 0;
    this.messageHistory = [];
    this.disconnectCount = 0;
    this.reconnectAttempts = 0;
    this.responseTimes = [];
    this.maxResponseTime = 0;
    this.minResponseTime = Infinity;
    this.webhooksSent = 0;
    this.webhooksFailed = 0;
    this.webhookLatencies = [];
  }
}

// 导出单例实例
export const metrics = new MetricsCollector();

export default metrics;
