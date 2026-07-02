/**
 * Tests for ClippyCoordinator Durable Object.
 * Focus: session persistence, state recovery, TTL extension, alarm scheduling,
 * and reconnection resilience — the sources of the reported expiry/reconnect failures.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClippyCoordinator } from '../../cloudflare/realtime/src/index.js';

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
  return {
    storage,
    blockConcurrencyWhile: async (fn) => await fn(),
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
    this.closed = false;
    this.closeCode = null;
    this.closeReason = null;
    this._listeners = {};
  }
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close(code, reason) { this.closed = true; this.closeCode = code; this.closeReason = reason; }
  accept() {}
  addEventListener(event, fn) { this._listeners[event] = fn; }
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

function makeWsRequest(ip = '1.2.3.4') {
  return {
    url: 'https://example.com/ws',
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

async function openSocket(coord, ip = '1.2.3.4') {
  const req = makeWsRequest(ip);
  await coord.fetch(req);
  const [, server] = _lastWsPair;
  const socketId = server.messages[0]?.socketId;
  return { server, socketId };
}

async function flushAsync() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function sendMsg(coord, server, msg) {
  // The DO message listener does not return the inner async Promise, so we must
  // flush the macrotask queue (setTimeout 0) to let all awaited microtasks settle.
  server._listeners.message({ data: JSON.stringify(msg) });
  await new Promise(resolve => setTimeout(resolve, 0));
  return server.last();
}

beforeEach(() => {
  _lastWsPair = null;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

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

    s1._listeners.close({ code: 1001, reason: 'gone' });
    await flushAsync();

    const session = coord.stateData.sessionsByCode[code];
    const device = session.devices.find(d => d.socketId === socketId);
    expect(device.status).toBe('temporarily_disconnected');
  });

  it('preserves session for reconnect within the disconnect grace period', async () => {
    const { coord } = await newCoordinator();
    const { server: s1 } = await openSocket(coord);
    await sendMsg(coord, s1, { type: 'create_session' });
    const { code } = s1.find('session_created');

    s1._listeners.close({});
    await flushAsync();

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
    s2._listeners.close({});
    await flushAsync();

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

    s2._listeners.close({});
    await flushAsync();
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

    s1._listeners.close({});
    await flushAsync();

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

    await s1._listeners.message({ data: 'not json{{{' });

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
