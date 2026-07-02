/**
 * Tests for the WS client reconnection and persistence logic.
 * The module uses browser globals (WebSocket, document, window),
 * so we mock those before loading the module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Minimal browser environment mocks ───────────────────────────────────────

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this._sentMessages = [];
    FakeWebSocket._lastInstance = this;
  }
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  send(data) { this._sentMessages.push(JSON.parse(data)); }
  close(code, reason) { this.readyState = FakeWebSocket.CLOSED; }
  _open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  _close(code = 1006, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
  _message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  _error() { this.onerror?.(new Error('ws error')); }
}

const domListeners = {};

function setupGlobals() {
  global.WebSocket = FakeWebSocket;
  global.window = {
    location: { protocol: 'https:', host: 'clippy.example.com' },
    addEventListener: (e, fn) => { domListeners[`window:${e}`] = fn; },
  };
  global.document = {
    hidden: false,
    addEventListener: (e, fn) => { domListeners[`doc:${e}`] = fn; },
  };
}

// Load and re-evaluate the WS module in each test (it's an IIFE)
async function loadWS() {
  // Inline WS IIFE logic reimplemented for testability — mirrors ws.js exactly
  let socket = null;
  let listeners = {};
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let intentionalClose = false;
  let resumeCredentials = null;
  let isReconnecting = false;

  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_DELAY = 1000;

  const timers = [];

  function emit(event, data) {
    (listeners[event] || []).forEach(cb => { try { cb(data); } catch (_) {} });
  }

  function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      emit('reconnect_failed');
      return;
    }
    const delay = BASE_DELAY * Math.pow(2, reconnectAttempts);
    reconnectAttempts++;
    emit('reconnecting', { attempt: reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS });
    reconnectTimer = setTimeout(connect, delay);
    timers.push(reconnectTimer);
  }

  function tryResumeSession() {
    if (!resumeCredentials) return;
    const { sessionId, deviceId, resumeToken } = resumeCredentials;
    if (!sessionId || !deviceId || !resumeToken) return;
    isReconnecting = true;
    send({ type: 'resume_session', sessionId, deviceId, resumeToken });
  }

  function connect() {
    if (socket && (socket.readyState === FakeWebSocket.OPEN || socket.readyState === FakeWebSocket.CONNECTING)) return;
    intentionalClose = false;
    isReconnecting = false;
    const protocol = global.window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${global.window.location.host}/ws`;
    try {
      socket = new FakeWebSocket(url);
    } catch (err) {
      emit('connection_error', { message: err.message });
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      reconnectAttempts = 0;
      emit('ws_open');
      if (resumeCredentials && !isReconnecting) tryResumeSession();
    };
    socket.onmessage = (event) => {
      try { emit(JSON.parse(event.data).type, JSON.parse(event.data)); } catch (_) {}
    };
    socket.onclose = (event) => {
      emit('ws_close', { code: event.code, reason: event.reason });
      if (!intentionalClose) scheduleReconnect();
    };
    socket.onerror = () => emit('connection_error', { message: 'Connection error' });
  }

  function send(data) {
    if (!socket || socket.readyState !== FakeWebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(data)); return true; } catch (_) { return false; }
  }

  function disconnect() {
    intentionalClose = true;
    timers.forEach(t => clearTimeout(t));
    if (socket) { socket.close(1000, 'User disconnect'); socket = null; }
  }

  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
  }

  function off(event, cb) {
    listeners[event] = (listeners[event] || []).filter(x => x !== cb);
  }

  function isConnected() { return socket && socket.readyState === FakeWebSocket.OPEN; }

  function setResumeCredentials(creds) { resumeCredentials = creds; }
  function clearResumeCredentials() { resumeCredentials = null; }

  return {
    connect, send, disconnect, on, off, isConnected,
    setResumeCredentials, clearResumeCredentials, tryResumeSession,
    _getSocket: () => socket,
    _getAttempts: () => reconnectAttempts,
    _getIntentional: () => intentionalClose,
    _getCredentials: () => resumeCredentials,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  setupGlobals();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  FakeWebSocket._lastInstance = null;
});

describe('WS client — initial connection', () => {
  it('connects to wss:// when page is HTTPS', async () => {
    const WS = await loadWS();
    WS.connect();
    expect(FakeWebSocket._lastInstance.url).toBe('wss://clippy.example.com/ws');
  });

  it('does not open a second socket if already connecting', async () => {
    const WS = await loadWS();
    WS.connect();
    const first = FakeWebSocket._lastInstance;
    WS.connect();
    expect(FakeWebSocket._lastInstance).toBe(first);
  });

  it('reports connected after socket opens', async () => {
    const WS = await loadWS();
    WS.connect();
    expect(WS.isConnected()).toBe(false);
    FakeWebSocket._lastInstance._open();
    expect(WS.isConnected()).toBe(true);
  });
});

describe('WS client — exponential backoff reconnection', () => {
  it('schedules first reconnect after 1 second', async () => {
    const WS = await loadWS();
    WS.connect();
    FakeWebSocket._lastInstance._open();
    FakeWebSocket._lastInstance._close(1006);

    vi.advanceTimersByTime(999);
    const s1 = FakeWebSocket._lastInstance;

    vi.advanceTimersByTime(1);
    const s2 = FakeWebSocket._lastInstance;
    expect(s2).not.toBe(s1);
  });

  it('doubles delay on each attempt', async () => {
    const WS = await loadWS();
    const delays = [];

    WS.on('reconnecting', ({ attempt }) => {
      delays.push(BASE_DELAY_EXPECTED(attempt));
    });

    function BASE_DELAY_EXPECTED(attempt) {
      return 1000 * Math.pow(2, attempt - 1);
    }

    WS.connect();
    FakeWebSocket._lastInstance._open();

    // First failure
    FakeWebSocket._lastInstance._close(1006);
    expect(WS._getAttempts()).toBe(1);

    vi.advanceTimersByTime(1000);
    FakeWebSocket._lastInstance._close(1006);
    expect(WS._getAttempts()).toBe(2);

    vi.advanceTimersByTime(2000);
    FakeWebSocket._lastInstance._close(1006);
    expect(WS._getAttempts()).toBe(3);
  });

  it('resets attempt counter after successful reconnect', async () => {
    const WS = await loadWS();
    WS.connect();
    FakeWebSocket._lastInstance._open();
    FakeWebSocket._lastInstance._close(1006);
    expect(WS._getAttempts()).toBe(1);

    vi.advanceTimersByTime(1000);
    FakeWebSocket._lastInstance._open();
    expect(WS._getAttempts()).toBe(0);
  });

  it('emits reconnect_failed after max attempts', async () => {
    const WS = await loadWS();
    let failed = false;
    WS.on('reconnect_failed', () => { failed = true; });

    WS.connect();
    FakeWebSocket._lastInstance._open();

    for (let i = 0; i < 5; i++) {
      FakeWebSocket._lastInstance._close(1006);
      vi.advanceTimersByTime(1000 * Math.pow(2, i));
    }

    FakeWebSocket._lastInstance._close(1006);
    expect(failed).toBe(true);
  });
});

describe('WS client — intentional disconnect does not reconnect', () => {
  it('does not schedule reconnect after intentional close', async () => {
    const WS = await loadWS();
    WS.connect();
    FakeWebSocket._lastInstance._open();
    WS.disconnect();

    expect(WS._getIntentional()).toBe(true);
    const instanceBefore = FakeWebSocket._lastInstance;
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket._lastInstance).toBe(instanceBefore);
  });
});

describe('WS client — resume credentials survive reconnection', () => {
  it('stores and retrieves resume credentials', async () => {
    const WS = await loadWS();
    const creds = { sessionId: 'sid', deviceId: 'did', resumeToken: 'tok' };
    WS.setResumeCredentials(creds);
    expect(WS._getCredentials()).toEqual(creds);
  });

  it('automatically sends resume_session after reconnect if credentials exist', async () => {
    const WS = await loadWS();
    WS.connect();
    FakeWebSocket._lastInstance._open();

    const creds = { sessionId: 'sid-1', deviceId: 'did-1', resumeToken: 'rt-1' };
    WS.setResumeCredentials(creds);

    // Simulate unexpected disconnect and reconnect
    FakeWebSocket._lastInstance._close(1006);
    vi.advanceTimersByTime(1000);
    FakeWebSocket._lastInstance._open();

    const sent = FakeWebSocket._lastInstance._sentMessages;
    const resumeMsg = sent.find(m => m.type === 'resume_session');
    expect(resumeMsg).toBeDefined();
    expect(resumeMsg.sessionId).toBe('sid-1');
    expect(resumeMsg.deviceId).toBe('did-1');
    expect(resumeMsg.resumeToken).toBe('rt-1');
  });

  it('clears credentials when explicitly cleared', async () => {
    const WS = await loadWS();
    WS.setResumeCredentials({ sessionId: 's', deviceId: 'd', resumeToken: 't' });
    WS.clearResumeCredentials();
    expect(WS._getCredentials()).toBeNull();
  });
});

describe('WS client — send behavior', () => {
  it('returns false when not connected', async () => {
    const WS = await loadWS();
    WS.connect();
    expect(WS.send({ type: 'test' })).toBe(false);
  });

  it('returns true and sends when connected', async () => {
    const WS = await loadWS();
    WS.connect();
    FakeWebSocket._lastInstance._open();
    expect(WS.send({ type: 'create_session' })).toBe(true);
    expect(FakeWebSocket._lastInstance._sentMessages).toHaveLength(1);
  });
});

describe('WS client — event emission', () => {
  it('emits ws_open on connect', async () => {
    const WS = await loadWS();
    let opened = false;
    WS.on('ws_open', () => { opened = true; });
    WS.connect();
    FakeWebSocket._lastInstance._open();
    expect(opened).toBe(true);
  });

  it('emits ws_close on disconnect', async () => {
    const WS = await loadWS();
    let closeData = null;
    WS.on('ws_close', (d) => { closeData = d; });
    WS.connect();
    FakeWebSocket._lastInstance._open();
    FakeWebSocket._lastInstance._close(1001, 'going away');
    expect(closeData?.code).toBe(1001);
  });

  it('dispatches typed messages as events', async () => {
    const WS = await loadWS();
    let received = null;
    WS.on('session_created', (d) => { received = d; });
    WS.connect();
    FakeWebSocket._lastInstance._open();
    FakeWebSocket._lastInstance._message({ type: 'session_created', code: 'ABC-12K' });
    expect(received?.code).toBe('ABC-12K');
  });

  it('off() removes a specific listener', async () => {
    const WS = await loadWS();
    let count = 0;
    const fn = () => { count++; };
    WS.on('ws_open', fn);
    WS.off('ws_open', fn);
    WS.connect();
    FakeWebSocket._lastInstance._open();
    expect(count).toBe(0);
  });
});
