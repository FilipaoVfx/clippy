/**
 * Tests for ClippyCoordinator Durable Object.
 * Focus: session persistence, state recovery, TTL extension, alarm scheduling,
 * and reconnection resilience — the sources of the reported expiry/reconnect failures.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClippyCoordinator, coordinatorNameFor } from '../../cloudflare/realtime/src/index.js';

// ─── Mock infrastructure ─────────────────────────────────────────────────────

function createMockStorage(initial = undefined) {
  const store = new Map();
  if (initial !== undefined) store.set('state', initial);
  let alarmTime = null;

  return {
    get: vi.fn(async (key) => store.get(key)),
    put: vi.fn(async (key, value) => store.set(key, value)),
    setAlarm: vi.fn(async (t) => { alarmTime = t; }),
    deleteAlarm: vi.fn(async () => { alarmTime = null; }),
    getAlarmTime: () => alarmTime,
    getState: () => store.get('state'),
  };
}

function createMockCtx(storage) {
  // Mirrors the hibernation API: the runtime owns the sockets and hands them
  // back via getWebSockets(), optionally filtered by the tags passed to accept.
  const accepted = [];

  return {
    storage,
    blockConcurrencyWhile: async (fn) => await fn(),
    acceptWebSocket: (ws, tags = []) => {
      ws._tags = tags;
      accepted.push(ws);
    },
    getWebSockets: (tag) => {
      const live = accepted.filter((ws) => !ws.closed);
      if (tag === undefined) return live;
      return live.filter((ws) => (ws._tags || []).includes(tag));
    },
    setWebSocketAutoResponse: () => {},
  };
}

function createMockEnv(overrides = {}) {
  return {
    SESSION_TTL_MS: '300000',
    DEVICE_DISCONNECT_TTL_MS: '60000',
    MAX_MESSAGE_SIZE: '10240',
    RATE_LIMIT_MAX: '30',
    RATE_LIMIT_WINDOW_MS: '60000',
    MAX_DEVICES: '5',
    ...overrides,
  };
}

class MockWebSocket {
  constructor() {
    this.messages = [];
    this.binary = [];
    this.closed = false;
    this.closeCode = null;
    this.closeReason = null;
    this._listeners = {};
  }
  send(raw) {
    if (typeof raw === 'string') this.messages.push(JSON.parse(raw));
    else this.binary.push(raw);
  }
  close(code, reason) { this.closed = true; this.closeCode = code; this.closeReason = reason; }
  accept() {}
  addEventListener(event, fn) { this._listeners[event] = fn; }
  // Attachments are structured-cloned by the real runtime; round-trip through
  // JSON so tests catch code that relies on holding a live reference.
  serializeAttachment(value) { this._attachment = JSON.stringify(value); }
  deserializeAttachment() { return this._attachment ? JSON.parse(this._attachment) : null; }
  last() { return this.messages[this.messages.length - 1]; }
  find(type) { return this.messages.find(m => m.type === type); }
}

// Module-level tracking for last created WebSocket pair
let _lastWsPair = null;

function installWebSocketPairMock() {
  // Must be a class so `new WebSocketPair()` works in the coordinator
  global.WebSocketPair = class WebSocketPairMock {
    constructor() {
      const client = new MockWebSocket();
      const server = new MockWebSocket();
      _lastWsPair = [client, server];
      this[0] = client;
      this[1] = server;
    }
  };
  global.Response = class Response {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status;
      this.webSocket = init.webSocket;
    }
  };
}

// Sessions are sharded by code, so a coordinator instance owns exactly one.
// Every socket in a test therefore connects with the same code.
const TEST_CODE = 'ABC-12K';

function makeWsRequest(ip = '1.2.3.4', code = TEST_CODE) {
  return {
    url: `https://example.com/ws?code=${encodeURIComponent(code)}`,
    headers: {
      get: (h) => {
        if (h === 'Upgrade') return 'websocket';
        if (h === 'cf-connecting-ip') return ip;
        return null;
      },
    },
  };
}

async function newCoordinator(storageData = undefined, envOverrides = {}) {
  installWebSocketPairMock();
  const storage = createMockStorage(storageData);
  const ctx = createMockCtx(storage);
  const env = createMockEnv(envOverrides);
  const coord = new ClippyCoordinator(ctx, env);
  await coord.ready;
  return { coord, storage };
}

async function openSocket(coord, ip = '1.2.3.4', code = TEST_CODE) {
  const req = makeWsRequest(ip, code);
  await coord.fetch(req);
  const [, server] = _lastWsPair;
  const socketId = server.messages[0]?.socketId;
  return { server, socketId };
}

// The hibernation handlers are plain async methods, so they can be awaited
// directly — no macrotask flushing needed as with the old event listeners.
async function sendMsg(coord, server, msg) {
  await coord.webSocketMessage(server, JSON.stringify(msg));
  return server.last();
}

/** Simulate the peer dropping the connection. */
async function closeSocket(coord, server) {
  server.closed = true;
  await coord.webSocketClose(server);
}

beforeEach(() => {
  _lastWsPair = null;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ClippyCoordinator — sharding by session code', () => {
  it('creates the session under the code carried in the connection URL', async () => {
    const { coord } = await newCoordinator();
    const { server } = await openSocket(coord, '1.1.1.1', 'ZZZ-42Q');

    await sendMsg(coord, server, { type: 'create_session' });

    expect(server.find('session_created').code).toBe('ZZZ-42Q');
  });

  it('reports code_taken instead of creating a second session in the same shard', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'create_session' });

    expect(s2.find('code_taken')).toBeDefined();
    expect(s2.find('session_created')).toBeUndefined();
  });

  it('rejects create_session when the connection carries no valid code', async () => {
    const { coord } = await newCoordinator();
    const { server } = await openSocket(coord, '1.1.1.1', 'not-a-code');

    await sendMsg(coord, server, { type: 'create_session' });

    expect(server.find('error')?.message).toMatch(/missing a valid session code/i);
    expect(server.find('session_created')).toBeUndefined();
  });

  it('rejects joining a code other than the one that routed here', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });

    // Socket reached this shard as ABC-12K but asks for a different session.
    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code: 'QQQ-11Q' });

    expect(s2.find('error')?.message).toMatch(/not found|expired/i);
    expect(s2.find('session_joined')).toBeUndefined();
  });

  it('routes each code to its own object and unknown codes to the lobby', () => {
    const named = (url) => coordinatorNameFor({ url });

    expect(named('https://x/ws?code=ABC-12K')).toBe('ABC-12K');
    expect(named('https://x/ws?code=abc-12k')).toBe('ABC-12K');
    expect(named('https://x/ws?code=QQQ-11Q')).not.toBe(named('https://x/ws?code=ABC-12K'));
    expect(named('https://x/ws')).toBe('lobby');
    expect(named('https://x/ws?code=garbage')).toBe('lobby');
  });
});

describe('ClippyCoordinator — session creation and state persistence', () => {
  it('creates a session and immediately persists state to storage', async () => {
    const { coord, storage } = await newCoordinator();
    const { server } = await openSocket(coord);

    await sendMsg(coord, server, { type: 'create_session' });

    const reply = server.find('session_created');
    expect(reply).toBeDefined();
    expect(reply.code).toMatch(/^[A-Z]{3}-[0-9]{2}[A-Z]$/);
    expect(reply.resumeToken).toMatch(/^[a-f0-9]{64}$/);

    expect(storage.put).toHaveBeenCalledWith('state', expect.objectContaining({
      sessionsByCode: expect.any(Object),
    }));
  });

  it('persists state after a device joins', async () => {
    const { coord, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const putsBefore = storage.put.mock.calls.length;
    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    expect(storage.put.mock.calls.length).toBeGreaterThan(putsBefore);
    const savedState = storage.getState();
    const session = Object.values(savedState.sessionsByCode)[0];
    expect(session.devices).toHaveLength(2);
  });
});

describe('ClippyCoordinator — state recovery after cold restart', () => {
  it('restores sessions from persisted storage on initialization', async () => {
    const { coord: c1, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(c1);
    await sendMsg(c1, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { coord: c2 } = await newCoordinator(storage.getState());
    expect(Object.keys(c2.stateData.sessionsByCode)).toContain(code);
  });

  it('resumes a session after DO cold restart using stored credentials', async () => {
    const { coord: c1, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(c1);
    await sendMsg(c1, s1, { type: 'create_session' });
    const { sessionId, deviceId, resumeToken } = s1.find('session_created');

    const { coord: c2 } = await newCoordinator(storage.getState());
    const { server: s2 } = await openSocket(c2);
    await sendMsg(c2, s2, { type: 'resume_session', sessionId, deviceId, resumeToken });

    const reply = s2.find('session_resumed');
    expect(reply).toBeDefined();
    expect(reply.sessionId).toBe(sessionId);
    expect(reply.code).toMatch(/^[A-Z]{3}-[0-9]{2}[A-Z]$/);
  });

  it('discards expired sessions on cold restart (no ghost sessions)', async () => {
    const { coord: c1, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(c1);
    await sendMsg(c1, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const state = storage.getState();
    state.sessionsByCode[code].expiresAt = Date.now() - 1;

    const { coord: c2 } = await newCoordinator(state);
    expect(Object.keys(c2.stateData.sessionsByCode)).not.toContain(code);
  });
});

describe('ClippyCoordinator — session TTL extension', () => {
  it('extends TTL when a device resumes', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code, sessionId, deviceId, resumeToken } = s1.find('session_created');

    coord.stateData.sessionsByCode[code].expiresAt = Date.now() + 5000;

    const { server: s2 } = await openSocket(coord);
    await sendMsg(coord, s2, { type: 'resume_session', sessionId, deviceId, resumeToken });

    const session = coord.stateData.sessionsByCode[code];
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 200_000);
  });

  it('extends TTL when a new device joins', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    coord.stateData.sessionsByCode[code].expiresAt = Date.now() + 5000;

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    const session = coord.stateData.sessionsByCode[code];
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 200_000);
  });
});

describe('ClippyCoordinator — device disconnect and reconnect lifecycle', () => {
  it('marks device as temporarily_disconnected on WebSocket close', async () => {
    const { coord } = await newCoordinator();
    const { server: s1, socketId } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    await closeSocket(coord, s1);

    const session = coord.stateData.sessionsByCode[code];
    const device = session.devices.find(d => d.socketId === socketId);
    expect(device.status).toBe('temporarily_disconnected');
  });

  it('preserves session for reconnect within the disconnect grace period', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    await closeSocket(coord, s1);

    expect(coord.stateData.sessionsByCode[code]).toBeDefined();
  });

  it('supersedes old socket when same device resumes on new connection', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code, sessionId, deviceId, resumeToken } = s1.find('session_created');

    const { server: s2, socketId: sid2 } = await openSocket(coord);
    await sendMsg(coord, s2, { type: 'resume_session', sessionId, deviceId, resumeToken });

    expect(s2.find('session_resumed')).toBeDefined();
    const session = coord.stateData.sessionsByCode[code];
    const device = session.devices.find(d => d.deviceId === deviceId);
    expect(device.socketId).toBe(sid2);
    expect(device.status).toBe('connected');
  });

  it('notifies peers when a device temporarily disconnects', async () => {
    const { coord } = await newCoordinator();

    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    s1.messages = [];
    await closeSocket(coord, s2);

    const notice = s1.find('device_disconnected');
    expect(notice).toBeDefined();
    expect(notice.devices).toBe(1);
  });

  it('notifies peers when a device reconnects', async () => {
    const { coord } = await newCoordinator();

    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });
    const { sessionId: sid2, deviceId: did2, resumeToken: rt2 } = s2.find('session_joined');

    await closeSocket(coord, s2);
    s1.messages = [];

    const { server: s3 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s3, { type: 'resume_session', sessionId: sid2, deviceId: did2, resumeToken: rt2 });

    const notice = s1.find('device_connected');
    expect(notice).toBeDefined();
    expect(notice.devices).toBe(2);
  });
});

describe('ClippyCoordinator — alarm scheduling for maximum persistence', () => {
  it('sets alarm after session creation', async () => {
    const { coord, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);

    storage.setAlarm.mockClear();
    await sendMsg(coord, s1, { type: 'create_session' });

    expect(storage.setAlarm).toHaveBeenCalled();
    expect(storage.getAlarmTime()).toBeGreaterThan(Date.now());
  });

  it('schedules alarm at or before session expiresAt', async () => {
    const { coord, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const sessionExpiry = coord.stateData.sessionsByCode[code].expiresAt;
    const alarmTime = storage.getAlarmTime();

    expect(alarmTime).toBeLessThanOrEqual(sessionExpiry + 1000);
  });

  it('deletes alarm when last session is removed', async () => {
    const { coord, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });

    storage.deleteAlarm.mockClear();
    await sendMsg(coord, s1, { type: 'leave_session' });

    expect(storage.deleteAlarm).toHaveBeenCalled();
  });

  it('alarm fires and cleans up expired sessions', async () => {
    const { coord, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    coord.stateData.sessionsByCode[code].expiresAt = Date.now() - 1;

    await coord.alarm();

    expect(coord.stateData.sessionsByCode[code]).toBeUndefined();
    expect(storage.put).toHaveBeenCalled();
  });

  it('alarm sets next alarm earlier when devices are temporarily disconnected', async () => {
    const { coord, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });

    await closeSocket(coord, s1);

    // Alarm should fire before full session TTL (300s) because disconnect TTL is 60s
    const alarmTime = storage.getAlarmTime();
    expect(alarmTime).toBeLessThan(Date.now() + 300_000);
  });
});

describe('ClippyCoordinator — session expiry notification', () => {
  it('sends session_expired to connected devices before closing', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    coord.stateData.sessionsByCode[code].expiresAt = Date.now() - 1;

    s1.messages = [];
    await coord.alarm();

    expect(s1.find('session_expired')).toBeDefined();
  });

  it('rejects join on an expired session and reports expiry', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    coord.stateData.sessionsByCode[code].expiresAt = Date.now() - 1;

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    const err = s2.find('error');
    expect(err?.message).toMatch(/expired/i);
  });

  it('rejects resume on an expired session', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code, sessionId, deviceId, resumeToken } = s1.find('session_created');

    coord.stateData.sessionsByCode[code].expiresAt = Date.now() - 1;

    const { server: s2 } = await openSocket(coord);
    await sendMsg(coord, s2, { type: 'resume_session', sessionId, deviceId, resumeToken });

    const err = s2.find('error');
    expect(err?.message).toMatch(/expired/i);
  });
});

describe('ClippyCoordinator — rate limiting', () => {
  it('blocks messages exceeding rate limit', async () => {
    const { coord } = await newCoordinator(undefined, { RATE_LIMIT_MAX: '2' });
    const { server: s1 } = await openSocket(coord);

    for (let i = 0; i < 3; i++) {
      await sendMsg(coord, s1, { type: 'create_session' });
    }

    const errors = s1.messages.filter(m => m.type === 'error' && /rate limit/i.test(m.message));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows messages within rate limit', async () => {
    const { coord } = await newCoordinator(undefined, { RATE_LIMIT_MAX: '5' });
    const { server: s1 } = await openSocket(coord);

    await sendMsg(coord, s1, { type: 'create_session' });

    const errors = s1.messages.filter(m => m.type === 'error' && /rate limit/i.test(m.message));
    expect(errors).toHaveLength(0);
  });

  it('blocks payloads exceeding the byte budget even when message count is fine', async () => {
    // Generous message allowance, tiny byte allowance: the byte lane must be
    // what rejects the payload.
    const { coord } = await newCoordinator(undefined, {
      RATE_LIMIT_MAX: '100',
      RATE_LIMIT_BYTES: '200',
      MAX_MESSAGE_SIZE: '10240',
    });
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });

    await sendMsg(coord, s1, { type: 'send_clip', content: 'x'.repeat(2000) });

    const errors = s1.messages.filter(m => m.type === 'error' && /rate limit/i.test(m.message));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('refills the byte budget over time', async () => {
    const { coord } = await newCoordinator(undefined, {
      RATE_LIMIT_BYTES: '1000',
      RATE_LIMIT_WINDOW_MS: '1000',
    });

    // Drain the byte lane, then advance the clock past a full window.
    expect(coord.checkRateLimit('9.9.9.9', { byteCost: 1000 })).toBe(true);
    expect(coord.checkRateLimit('9.9.9.9', { byteCost: 1000 })).toBe(false);

    const realNow = Date.now;
    Date.now = () => realNow() + 2000;
    try {
      expect(coord.checkRateLimit('9.9.9.9', { byteCost: 1000 })).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('does not spend message tokens for zero-cost lanes (chunked transfers)', async () => {
    const { coord } = await newCoordinator(undefined, { RATE_LIMIT_MAX: '2' });

    // A chunked transfer sends many frames; charging each one a message token
    // would abort the transfer after RATE_LIMIT_MAX frames.
    for (let i = 0; i < 50; i++) {
      expect(coord.checkRateLimit('8.8.8.8', { msgCost: 0, byteCost: 1024 })).toBe(true);
    }
  });
});

describe('ClippyCoordinator — clipboard relay', () => {
  it('relays clip to peer and acknowledges sender', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    s1.messages = [];
    s2.messages = [];

    await sendMsg(coord, s1, { type: 'send_clip', content: 'hello world' });

    expect(s1.find('clip_sent')).toBeDefined();
    const received = s2.find('receive_clip');
    expect(received).toBeDefined();
    expect(received.content).toBe('hello world');
  });

  it('sanitizes HTML in clipboard content', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    await sendMsg(coord, s1, { type: 'send_clip', content: '<script>alert(1)</script>' });

    const received = s2.find('receive_clip');
    expect(received.content).not.toContain('<script>');
    expect(received.content).toContain('&lt;script&gt;');
  });

  it('rejects oversized messages', async () => {
    const { coord } = await newCoordinator(undefined, { MAX_MESSAGE_SIZE: '10' });
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });

    await sendMsg(coord, s1, { type: 'send_clip', content: 'x'.repeat(50) });

    const err = s1.find('error');
    expect(err?.message).toMatch(/exceeds/i);
  });

  it('rejects send_clip when not in a session', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);

    await sendMsg(coord, s1, { type: 'send_clip', content: 'test' });

    const err = s1.find('error');
    expect(err?.message).toMatch(/not in a session/i);
  });
});

describe('ClippyCoordinator — session capacity', () => {
  it('rejects join when session is at MAX_DEVICES', async () => {
    const { coord } = await newCoordinator(undefined, { MAX_DEVICES: '2' });
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    const { server: s3 } = await openSocket(coord, '3.3.3.3');
    await sendMsg(coord, s3, { type: 'join_session', code });

    const err = s3.find('error');
    expect(err?.message).toMatch(/full/i);
  });
});

describe('ClippyCoordinator — invalid messages', () => {
  it('responds with error for unknown event type', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);

    await sendMsg(coord, s1, { type: 'unknown_event' });

    expect(s1.find('error')).toBeDefined();
  });

  it('responds with error for malformed JSON', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);

    await coord.webSocketMessage(s1, 'not json{{{');

    expect(s1.find('error')).toBeDefined();
  });

  it('rejects resume with missing credentials', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);

    await sendMsg(coord, s1, { type: 'resume_session', sessionId: 'x' });

    const err = s1.find('error');
    expect(err?.message).toMatch(/missing/i);
  });

  it('rejects join with invalid code format', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);

    await sendMsg(coord, s1, { type: 'join_session', code: 'invalid' });

    const err = s1.find('error');
    expect(err?.message).toMatch(/invalid code/i);
  });
});

// ─── Chunked transfers (RF-15) ───────────────────────────────────────────────

const TRANSFER_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function chunkFrame(transferId, index, payloadBytes) {
  const buf = new Uint8Array(21 + payloadBytes.length);
  buf[0] = 1;
  for (let i = 0; i < 16; i += 1) {
    buf[1 + i] = parseInt(transferId.substr(i * 2, 2), 16);
  }
  new DataView(buf.buffer).setUint32(17, index, false);
  buf.set(payloadBytes, 21);
  return buf.buffer;
}

/** Open a session with two devices and return both sockets. */
async function pairedSession(coord, envOverrides) {
  const { server: s1 } = await openSocket(coord, '1.1.1.1');
  await sendMsg(coord, s1, { type: 'create_session' });
  const { code } = s1.find('session_created');
  const { server: s2 } = await openSocket(coord, '2.2.2.2');
  await sendMsg(coord, s2, { type: 'join_session', code });
  s1.messages = [];
  s2.messages = [];
  return { s1, s2, code };
}

function startMsg(overrides = {}) {
  return {
    type: 'transfer_start',
    transferId: TRANSFER_ID,
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    size: 1000,
    chunkSize: 500,
    chunkCount: 2,
    ...overrides,
  };
}

describe('ClippyCoordinator — chunked transfers (RF-15)', () => {
  it('announces an incoming transfer to the peer', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);

    await sendMsg(coord, s2, startMsg());

    const incoming = s1.find('transfer_incoming');
    expect(incoming).toBeDefined();
    expect(incoming.transferId).toBe(TRANSFER_ID);
    expect(incoming.mimeType).toBe('video/mp4');
    expect(incoming.chunkCount).toBe(2);
  });

  it('relays chunk frames to the peer byte-for-byte', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);
    await sendMsg(coord, s2, startMsg());

    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    const frame = chunkFrame(TRANSFER_ID, 0, payload);
    await coord.webSocketMessage(s2, frame);

    const relayed = s1.binary[s1.binary.length - 1];
    expect(relayed).toBeDefined();
    expect(new Uint8Array(relayed)).toEqual(new Uint8Array(frame));
  });

  it('never writes transfer payload to Durable Object storage', async () => {
    const { coord, storage } = await newCoordinator();
    const { s2 } = await pairedSession(coord);
    await sendMsg(coord, s2, startMsg({ size: 4096, chunkSize: 1024, chunkCount: 4 }));

    const putsBefore = storage.put.mock.calls.length;
    for (let i = 0; i < 4; i += 1) {
      await coord.webSocketMessage(s2, chunkFrame(TRANSFER_ID, i, new Uint8Array(1024)));
    }

    expect(storage.put.mock.calls.length).toBe(putsBefore);
  });

  it('signals completion once every declared byte has been relayed', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);
    await sendMsg(coord, s2, startMsg({ size: 20, chunkSize: 10, chunkCount: 2 }));

    await coord.webSocketMessage(s2, chunkFrame(TRANSFER_ID, 0, new Uint8Array(10)));
    await coord.webSocketMessage(s2, chunkFrame(TRANSFER_ID, 1, new Uint8Array(10)));
    await sendMsg(coord, s2, { type: 'transfer_end', transferId: TRANSFER_ID });

    expect(s1.find('transfer_complete')).toBeDefined();
  });

  it('reports an abort when the transfer ends short of its declared size', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);
    await sendMsg(coord, s2, startMsg({ size: 20, chunkSize: 10, chunkCount: 2 }));

    await coord.webSocketMessage(s2, chunkFrame(TRANSFER_ID, 0, new Uint8Array(10)));
    await sendMsg(coord, s2, { type: 'transfer_end', transferId: TRANSFER_ID });

    expect(s1.find('transfer_complete')).toBeUndefined();
    expect(s1.find('transfer_aborted')?.reason).toMatch(/ended early/i);
  });

  it('aborts a sender that overruns its declared size', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);
    await sendMsg(coord, s2, startMsg({ size: 10, chunkSize: 10, chunkCount: 1 }));

    await coord.webSocketMessage(s2, chunkFrame(TRANSFER_ID, 0, new Uint8Array(999)));

    expect(s2.find('transfer_aborted')?.reason).toMatch(/exceeded declared size/i);
    expect(s1.binary).toHaveLength(0);
  });

  it('rejects a video above the size limit', async () => {
    const { coord } = await newCoordinator(undefined, { VIDEO_MAX_BYTES: '1000' });
    const { s2 } = await pairedSession(coord);

    await sendMsg(coord, s2, startMsg({ size: 5000, chunkSize: 1000, chunkCount: 5 }));

    expect(s2.find('transfer_aborted')?.reason).toMatch(/exceeds/i);
  });

  it('rejects an unsupported container', async () => {
    const { coord } = await newCoordinator();
    const { s2 } = await pairedSession(coord);

    await sendMsg(coord, s2, startMsg({ mimeType: 'application/zip' }));

    expect(s2.find('transfer_aborted')?.reason).toMatch(/unsupported format/i);
  });

  it('rejects framing that does not match the declared size', async () => {
    const { coord } = await newCoordinator();
    const { s2 } = await pairedSession(coord);

    await sendMsg(coord, s2, startMsg({ size: 1000, chunkSize: 100, chunkCount: 3 }));

    expect(s2.find('error')?.message).toMatch(/invalid transfer framing/i);
  });

  it('ignores chunks for a transfer that was never started', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);

    await coord.webSocketMessage(s2, chunkFrame(TRANSFER_ID, 0, new Uint8Array(10)));

    expect(s1.binary).toHaveLength(0);
  });

  it('does not let one socket push chunks onto another socket\'s transfer', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);
    await sendMsg(coord, s2, startMsg());
    s1.binary.length = 0;

    // s1 is the receiver, not the owner of TRANSFER_ID.
    await coord.webSocketMessage(s1, chunkFrame(TRANSFER_ID, 0, new Uint8Array(10)));

    expect(s2.binary).toHaveLength(0);
  });

  it('refuses to start a transfer with no peers to receive it', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });

    await sendMsg(coord, s1, startMsg());

    expect(s1.find('transfer_aborted')?.reason).toMatch(/no connected peers/i);
  });

  it('tells the peer when the sender disconnects mid-transfer', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);
    await sendMsg(coord, s2, startMsg());

    await closeSocket(coord, s2);

    expect(s1.find('transfer_aborted')?.reason).toMatch(/sender disconnected/i);
  });

  it('routes receiver acks back to the sender only', async () => {
    const { coord } = await newCoordinator();
    const { s1, s2 } = await pairedSession(coord);
    await sendMsg(coord, s2, startMsg());
    s1.messages = [];

    await sendMsg(coord, s1, { type: 'transfer_ack', transferId: TRANSFER_ID, upTo: 1 });

    expect(s2.find('transfer_ack')?.upTo).toBe(1);
    expect(s1.find('transfer_ack')).toBeUndefined();
  });
});

// ─── Image relay (RF-13/RF-14) ───────────────────────────────────────────────

// Minimal valid 1×1 PNG as data URI (base64)
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVIP/2Q==';

describe('ClippyCoordinator — image relay (RF-13/RF-14)', () => {
  it('relays a valid PNG image to peers and confirms to sender', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    s1.messages = []; // clear
    await sendMsg(coord, s2, { type: 'send_image', data: TINY_PNG });

    const confirmation = s2.find('image_sent');
    expect(confirmation).toBeDefined();
    expect(confirmation.timestamp).toBeGreaterThan(0);

    const received = s1.find('receive_image');
    expect(received).toBeDefined();
    expect(received.data).toBe(TINY_PNG);
    expect(received.mimeType).toBe('image/png');
    expect(received.timestamp).toBeGreaterThan(0);
  });

  it('relays a valid JPEG image', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    await sendMsg(coord, s2, { type: 'send_image', data: TINY_JPEG });

    const received = s1.find('receive_image');
    expect(received).toBeDefined();
    expect(received.mimeType).toBe('image/jpeg');
  });

  it('does not store image data in Durable Object storage', async () => {
    const { coord, storage } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    const putsBefore = storage.put.mock.calls.length;
    await sendMsg(coord, s2, { type: 'send_image', data: TINY_PNG });
    const putsAfter = storage.put.mock.calls.length;

    // No additional state.put calls — image must NOT be written to storage
    expect(putsAfter).toBe(putsBefore);
  });

  it('rejects send_image when not in a session', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);

    await sendMsg(coord, s1, { type: 'send_image', data: TINY_PNG });

    expect(s1.find('error')?.message).toMatch(/not in a session/i);
  });

  it('rejects send_image with no connected peers', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });

    await sendMsg(coord, s1, { type: 'send_image', data: TINY_PNG });

    expect(s1.find('error')?.message).toMatch(/no connected peers/i);
  });

  it('rejects send_image with invalid data URI', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    await sendMsg(coord, s2, { type: 'send_image', data: 'not-a-data-uri' });

    expect(s2.find('error')?.message).toMatch(/invalid image format/i);
  });

  it('rejects send_image with unsupported mime type (SVG)', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    await sendMsg(coord, s2, {
      type: 'send_image',
      data: 'data:image/svg+xml;base64,PHN2Zyc+PC9zdmc+',
    });

    expect(s2.find('error')?.message).toMatch(/invalid image format/i);
  });

  it('rejects send_image exceeding size limit', async () => {
    const { coord } = await newCoordinator(undefined, { IMAGE_MAX_BYTES: '100' });
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    // Build a data URI > 100 bytes decoded
    const bigData = 'data:image/png;base64,' + 'A'.repeat(200);
    await sendMsg(coord, s2, { type: 'send_image', data: bigData });

    expect(s2.find('error')?.message).toMatch(/exceeds/i);
  });

  it('sends image to all connected peers in a multi-device session', async () => {
    const { coord } = await newCoordinator(undefined, { MAX_DEVICES: '3' });
    const { server: s1 } = await openSocket(coord, '1.1.1.1');
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    const { server: s2 } = await openSocket(coord, '2.2.2.2');
    await sendMsg(coord, s2, { type: 'join_session', code });

    const { server: s3 } = await openSocket(coord, '3.3.3.3');
    await sendMsg(coord, s3, { type: 'join_session', code });

    s1.messages = [];
    s2.messages = [];
    await sendMsg(coord, s3, { type: 'send_image', data: TINY_PNG });

    expect(s1.find('receive_image')).toBeDefined();
    expect(s2.find('receive_image')).toBeDefined();
    expect(s3.find('image_sent')).toBeDefined();
    expect(s3.find('receive_image')).toBeUndefined(); // sender doesn't receive own image
  });
});
