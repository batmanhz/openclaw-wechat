import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WechatyClient, MessagePayload, WechatyClientConfig } from '../src/bridge/wechaty-client.js';
import { EventEmitter } from 'events';

// Mock wechaty module
vi.mock('wechaty', () => ({
  WechatyBuilder: {
    build: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      isLoggedIn: false,
      userSelf: vi.fn(),
      Contact: { findAll: vi.fn().mockResolvedValue([]) },
      Room: { findAll: vi.fn().mockResolvedValue([]) },
    })),
  },
  Contact: class MockContact {},
  Room: class MockRoom {},
  Message: class MockMessage {},
}));

vi.mock('memory-card', () => ({
  MemoryCard: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

describe('WechatyClient', () => {
  let client: WechatyClient;

  beforeEach(() => {
    vi.useFakeTimers();
    const config: WechatyClientConfig = {
      name: 'test-bot',
      reconnectInterval: 1000,
      maxReconnectAttempts: 3,
      heartbeatInterval: 5000,
      contactsCacheTtl: 300000,
    };
    client = new WechatyClient(config);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default config', () => {
      const defaultClient = new WechatyClient();
      expect(defaultClient).toBeInstanceOf(EventEmitter);
      expect(defaultClient).toBeInstanceOf(WechatyClient);
    });

    it('should initialize with custom config', () => {
      expect(client).toBeInstanceOf(WechatyClient);
    });
  });

  describe('Status Management', () => {
    it('should return initial status', () => {
      const status = client.getStatus();
      expect(status).toHaveProperty('valid');
      expect(status).toHaveProperty('isLoggedIn');
      expect(status).toHaveProperty('wcId');
      expect(status).toHaveProperty('nickName');
      expect(status.isLoggedIn).toBe(false);
      expect(status.valid).toBe(true);
    });

    it('should return reconnect status', () => {
      const status = client.getReconnectStatus();
      expect(status).toHaveProperty('isReconnecting');
      expect(status).toHaveProperty('attempts');
      expect(status).toHaveProperty('maxAttempts');
      expect(status.isReconnecting).toBe(false);
      expect(status.attempts).toBe(0);
    });

    it('should return heartbeat status', () => {
      const status = client.getHeartbeatStatus();
      expect(status).toHaveProperty('lastHeartbeat');
      expect(status).toHaveProperty('missedCount');
      expect(status).toHaveProperty('maxMissed');
      expect(status).toHaveProperty('interval');
      expect(status.missedCount).toBe(0);
    });
  });

  describe('Message Type Mapping', () => {
    it('should map message types correctly', () => {
      // Access private method for testing
      const mapMessageType = (client as any).mapMessageType.bind(client);
      
      expect(mapMessageType(7)).toBe('text');   // Message.Type.Text
      expect(mapMessageType(6)).toBe('image');  // Message.Type.Image
      expect(mapMessageType(1)).toBe('file');   // Message.Type.Attachment
      expect(mapMessageType(99)).toBe('unknown');
    });
  });

  describe('Message Deduplication', () => {
    it('should track processed messages', () => {
      const processedMessages = (client as any).processedMessages;
      
      expect(processedMessages.size).toBe(0);
      
      // Add a message
      processedMessages.add('msg-123');
      expect(processedMessages.has('msg-123')).toBe(true);
      expect(processedMessages.size).toBe(1);
    });

    it('should cleanup old messages when exceeding max history', () => {
      const processedMessages = (client as any).processedMessages;
      const maxHistory = (client as any).maxMessageHistory;
      
      // Add more messages than max
      for (let i = 0; i < maxHistory + 10; i++) {
        processedMessages.add(`msg-${i}`);
      }
      
      expect(processedMessages.size).toBe(maxHistory + 10);
      
      // Trigger cleanup
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      // Should be cleaned up
      expect(processedMessages.size).toBeLessThanOrEqual(maxHistory);
    });
  });

  describe('Contact Cache', () => {
    it('should initialize with null cache', () => {
      const cache = (client as any).contactsCache;
      expect(cache).toBeNull();
    });

    it('should have default cache TTL', () => {
      const ttl = (client as any).contactsCacheTtl;
      expect(ttl).toBe(300000); // 5 minutes
    });
  });

  describe('Event Emitter', () => {
    it('should emit events', () => {
      const listener = vi.fn();
      client.on('test', listener);
      client.emit('test', 'data');
      expect(listener).toHaveBeenCalledWith('data');
    });

    it('should handle multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      client.on('test', listener1);
      client.on('test', listener2);
      client.emit('test', 'data');
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });
});
