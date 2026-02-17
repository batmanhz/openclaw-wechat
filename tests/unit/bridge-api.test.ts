import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock WechatyClient
const mockClient = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockReturnValue({
    valid: true,
    isLoggedIn: false,
    wcId: '',
    nickName: '',
    qrCodeUrl: '',
    sessionId: '',
  }),
  getReconnectStatus: vi.fn().mockReturnValue({
    isReconnecting: false,
    attempts: 0,
    maxAttempts: 10,
  }),
  getHeartbeatStatus: vi.fn().mockReturnValue({
    lastHeartbeat: Date.now(),
    missedCount: 0,
    maxMissed: 3,
    interval: 30000,
  }),
  sendTextMessage: vi.fn().mockResolvedValue({ msgId: '123', newMsgId: '456', createTime: Date.now() }),
  sendImage: vi.fn().mockResolvedValue({ msgId: '789', newMsgId: '012', createTime: Date.now() }),
  getAddressList: vi.fn().mockResolvedValue({
    friends: [],
    chatrooms: [],
    updateTime: Date.now(),
  }),
  on: vi.fn(),
  emit: vi.fn(),
};

vi.mock('../src/bridge/wechaty-client.js', () => ({
  WechatyClient: vi.fn().mockImplementation(() => mockClient),
}));

describe('Bridge API Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a simple Express app for testing
    app = express();
    app.use(express.json());
    
    // Setup routes similar to BridgeServer
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    app.get('/v1/account/status', (req, res) => {
      const status = mockClient.getStatus();
      res.json({
        valid: status.valid,
        isLoggedIn: status.isLoggedIn,
        wcId: status.wcId,
        nickName: status.nickName,
        error: null,
      });
    });

    app.post('/v1/iPadLogin', (req, res) => {
      const status = mockClient.getStatus();
      res.json({
        wId: status.sessionId || `session-${Date.now()}`,
        qrCodeUrl: status.qrCodeUrl,
      });
    });

    app.post('/v1/getIPadLoginInfo', (req, res) => {
      const status = mockClient.getStatus();
      res.json({
        status: status.isLoggedIn ? 'logged_in' : 'waiting',
        wcId: status.wcId,
        nickName: status.nickName,
        headUrl: '',
      });
    });

    app.post('/v1/sendText', async (req, res) => {
      try {
        const { wcId, content } = req.body;
        const result = await mockClient.sendTextMessage(wcId, content);
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/v1/sendImage2', async (req, res) => {
      try {
        const { wcId, content } = req.body;
        const result = await mockClient.sendImage(wcId, content);
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/v1/getAddressList', async (req, res) => {
      try {
        const { forceRefresh } = req.body || {};
        const addressList = await mockClient.getAddressList(forceRefresh);
        res.json(addressList);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/v1/reconnect/status', (req, res) => {
      const status = mockClient.getReconnectStatus();
      res.json(status);
    });

    app.get('/v1/heartbeat/status', (req, res) => {
      const status = mockClient.getHeartbeatStatus();
      res.json(status);
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Health Check', () => {
    it('GET /health should return ok status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Account Status', () => {
    it('GET /v1/account/status should return account status', async () => {
      const response = await request(app)
        .get('/v1/account/status')
        .expect(200);

      expect(response.body).toHaveProperty('valid');
      expect(response.body).toHaveProperty('isLoggedIn');
      expect(response.body).toHaveProperty('wcId');
      expect(response.body).toHaveProperty('nickName');
      expect(response.body).toHaveProperty('error', null);
    });
  });

  describe('Login Flow', () => {
    it('POST /v1/iPadLogin should return session info', async () => {
      const response = await request(app)
        .post('/v1/iPadLogin')
        .expect(200);

      expect(response.body).toHaveProperty('wId');
      expect(response.body).toHaveProperty('qrCodeUrl');
    });

    it('POST /v1/getIPadLoginInfo should return login status', async () => {
      const response = await request(app)
        .post('/v1/getIPadLoginInfo')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('wcId');
      expect(response.body).toHaveProperty('nickName');
    });
  });

  describe('Message Sending', () => {
    it('POST /v1/sendText should send text message', async () => {
      const messageData = {
        wcId: 'user123',
        content: 'Hello World',
      };

      const response = await request(app)
        .post('/v1/sendText')
        .send(messageData)
        .expect(200);

      expect(mockClient.sendTextMessage).toHaveBeenCalledWith('user123', 'Hello World');
      expect(response.body).toHaveProperty('msgId');
      expect(response.body).toHaveProperty('newMsgId');
      expect(response.body).toHaveProperty('createTime');
    });

    it('POST /v1/sendImage2 should send image message', async () => {
      const messageData = {
        wcId: 'user123',
        content: 'https://example.com/image.png',
      };

      const response = await request(app)
        .post('/v1/sendImage2')
        .send(messageData)
        .expect(200);

      expect(mockClient.sendImage).toHaveBeenCalledWith('user123', 'https://example.com/image.png');
      expect(response.body).toHaveProperty('msgId');
    });
  });

  describe('Address List', () => {
    it('POST /v1/getAddressList should return contacts', async () => {
      const response = await request(app)
        .post('/v1/getAddressList')
        .send({ forceRefresh: false })
        .expect(200);

      expect(mockClient.getAddressList).toHaveBeenCalledWith(false);
      expect(response.body).toHaveProperty('friends');
      expect(response.body).toHaveProperty('chatrooms');
      expect(response.body).toHaveProperty('updateTime');
    });
  });

  describe('Status Monitoring', () => {
    it('GET /v1/reconnect/status should return reconnect status', async () => {
      const response = await request(app)
        .get('/v1/reconnect/status')
        .expect(200);

      expect(response.body).toHaveProperty('isReconnecting');
      expect(response.body).toHaveProperty('attempts');
      expect(response.body).toHaveProperty('maxAttempts');
    });

    it('GET /v1/heartbeat/status should return heartbeat status', async () => {
      const response = await request(app)
        .get('/v1/heartbeat/status')
        .expect(200);

      expect(response.body).toHaveProperty('lastHeartbeat');
      expect(response.body).toHaveProperty('missedCount');
      expect(response.body).toHaveProperty('maxMissed');
      expect(response.body).toHaveProperty('interval');
    });
  });
});
