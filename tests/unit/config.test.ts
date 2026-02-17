import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

describe('Config Schema Validation', () => {
  const BridgeConfigSchema = z.object({
    server: z.object({
      port: z.number().min(1).max(65535).default(3001),
      host: z.string().default('0.0.0.0'),
    }),
    wechaty: z.object({
      name: z.string().default('openclaw-wechat'),
      puppet: z.string().default('wechaty-puppet-wechat'),
      puppetToken: z.string().optional(),
      memoryCardPath: z.string().default('./data'),
      reconnectInterval: z.number().min(1000).default(5000),
      maxReconnectAttempts: z.number().min(1).default(10),
      heartbeatInterval: z.number().min(1000).default(30000),
    }),
  });

  const WechatyClientConfigSchema = z.object({
    name: z.string().default('openclaw-wechat'),
    puppet: z.string().default('wechaty-puppet-wechat'),
    puppetToken: z.string().optional(),
    memoryCardPath: z.string().default('./data'),
    reconnectInterval: z.number().min(1000).default(5000),
    maxReconnectAttempts: z.number().min(1).default(10),
    heartbeatInterval: z.number().min(1000).default(30000),
    contactsCacheTtl: z.number().min(60000).default(300000),
  });

  describe('BridgeConfig Schema', () => {
    it('should validate valid config', () => {
      const config = {
        server: {
          port: 3001,
          host: 'localhost',
        },
        wechaty: {
          name: 'test-bot',
          puppet: 'wechaty-puppet-wechat',
          reconnectInterval: 5000,
        },
      };

      const result = BridgeConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should apply defaults for missing values', () => {
      const config = {
        server: {},
        wechaty: {},
      };

      const result = BridgeConfigSchema.parse(config);
      expect(result.server.port).toBe(3001);
      expect(result.server.host).toBe('0.0.0.0');
      expect(result.wechaty.name).toBe('openclaw-wechat');
      expect(result.wechaty.puppet).toBe('wechaty-puppet-wechat');
    });

    it('should reject invalid port', () => {
      const config = {
        server: {
          port: 70000,
          host: 'localhost',
        },
        wechaty: {},
      };

      const result = BridgeConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject negative reconnect interval', () => {
      const config = {
        server: {},
        wechaty: {
          reconnectInterval: -1000,
        },
      };

      const result = BridgeConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('WechatyClientConfig Schema', () => {
    it('should validate valid config', () => {
      const config = {
        name: 'test-bot',
        puppet: 'wechaty-puppet-padlocal',
        puppetToken: 'test-token-123',
        memoryCardPath: './custom-data',
        reconnectInterval: 10000,
        maxReconnectAttempts: 5,
        heartbeatInterval: 60000,
        contactsCacheTtl: 600000,
      };

      const result = WechatyClientConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const config = {};

      const result = WechatyClientConfigSchema.parse(config);
      expect(result.name).toBe('openclaw-wechat');
      expect(result.puppet).toBe('wechaty-puppet-wechat');
      expect(result.reconnectInterval).toBe(5000);
      expect(result.maxReconnectAttempts).toBe(10);
      expect(result.heartbeatInterval).toBe(30000);
      expect(result.contactsCacheTtl).toBe(300000);
    });

    it('should make puppetToken optional', () => {
      const config = {
        name: 'test-bot',
      };

      const result = WechatyClientConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.puppetToken).toBeUndefined();
      }
    });

    it('should enforce minimum contacts cache TTL', () => {
      const config = {
        contactsCacheTtl: 1000, // Too low
      };

      const result = WechatyClientConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('Environment Variable Parsing', () => {
    it('should parse numeric env vars correctly', () => {
      const envVars = {
        PORT: '3001',
        RECONNECT_INTERVAL: '5000',
        MAX_RECONNECT_ATTEMPTS: '10',
      };

      const parsed = {
        port: parseInt(envVars.PORT, 10),
        reconnectInterval: parseInt(envVars.RECONNECT_INTERVAL, 10),
        maxReconnectAttempts: parseInt(envVars.MAX_RECONNECT_ATTEMPTS, 10),
      };

      expect(parsed.port).toBe(3001);
      expect(parsed.reconnectInterval).toBe(5000);
      expect(parsed.maxReconnectAttempts).toBe(10);
    });

    it('should use defaults for missing env vars', () => {
      const envVars: Record<string, string> = {};

      const parsed = {
        port: parseInt(envVars.PORT || '3001', 10),
        host: envVars.HOST || '0.0.0.0',
      };

      expect(parsed.port).toBe(3001);
      expect(parsed.host).toBe('0.0.0.0');
    });
  });
});
