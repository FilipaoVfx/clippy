import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let sm;

beforeEach(() => {
  sm = require('../../server/sessionManager');
  sm._reset();
});

// ─── Session Creation ────────────────────────────────────────────────────────

describe('createSession', () => {
  it('returns a code, sessionId, deviceId, and resumeToken', () => {
    const result = sm.createSession('socket-1');
    expect(result.code).toMatch(/^[A-Z]{3}-[0-9]{2}[A-Z]$/);
    expect(result.sessionId).toBeTruthy();
    expect(result.deviceId).toBeTruthy();
    expect(result.resumeToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates the session with active state and correct TTL', () => {
    const before = Date.now();
    const { code } = sm.createSession('socket-1');
    const after = Date.now();

    const session = sm.getSession(code);
    expect(session.state).toBe('active');
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 1_000);
    expect(session.expiresAt).toBeLessThanOrEqual(after + 1_800_000 + 100);
  });

  it('registers the device as connected', () => {
    const { code, deviceId } = sm.createSession('socket-1');
    const session = sm.getSession(code);
    const device = session.devices.find(d => d.deviceId === deviceId);
    expect(device.status).toBe('connected');
    expect(device.socketId).toBe('socket-1');
  });

  it('generates unique codes for concurrent sessions', () => {
    const codes = new Set();
    for (let i = 0; i < 20; i++) {
      const { code } = sm.createSession(`socket-${i}`);
      codes.add(code);
    }
    expect(codes.size).toBe(20);
  });

  it('links socketId to session for lookup', () => {
    const { code } = sm.createSession('socket-1');
    expect(sm.getCodeBySocket('socket-1')).toBe(code);
  });
});

// ─── Session Join ────────────────────────────────────────────────────────────

describe('joinSession', () => {
  it('adds a second device and extends TTL', () => {
    const { code } = sm.createSession('socket-1');
    const session = sm.getSession(code);

    // Shorten the TTL so extension is clearly measurable
    const shortExpiry = Date.now() + 1000;
    session.expiresAt = shortExpiry;

    const result = sm.joinSession(code, 'socket-2');
    expect(result.success).toBe(true);
    expect(result.deviceId).toBeTruthy();
    expect(result.resumeToken).toMatch(/^[a-f0-9]{64}$/);

    const updated = sm.getSession(code);
    expect(updated.expiresAt).toBeGreaterThan(shortExpiry + 100_000);
    expect(updated.devices).toHaveLength(2);
  });

  it('fails if code does not exist', () => {
    const result = sm.joinSession('ZZZ-99Z', 'socket-2');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('fails if session has expired', () => {
    const { code } = sm.createSession('socket-1');
    const session = sm.getSession(code);
    session.expiresAt = Date.now() - 1;

    const result = sm.joinSession(code, 'socket-2');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('rejects when session is at max devices', () => {
    const { code } = sm.createSession('socket-1');
    for (let i = 2; i <= sm.MAX_DEVICES; i++) {
      sm.joinSession(code, `socket-${i}`);
    }
    const result = sm.joinSession(code, `socket-${sm.MAX_DEVICES + 1}`);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/full/i);
  });

  it('each joined device gets a unique resumeToken', () => {
    const { code, resumeToken: token1 } = sm.createSession('socket-1');
    const { resumeToken: token2 } = sm.joinSession(code, 'socket-2');
    expect(token1).not.toBe(token2);
  });
});

// ─── Session Resume ──────────────────────────────────────────────────────────

describe('resumeSession — critical for cross-device persistence', () => {
  it('resumes with valid credentials and extends TTL', () => {
    const { code, sessionId, deviceId, resumeToken } = sm.createSession('socket-1');
    const session = sm.getSession(code);
    session.expiresAt = Date.now() + 5000;

    const before = Date.now();
    const result = sm.resumeSession(sessionId, deviceId, resumeToken, 'socket-2');
    expect(result.success).toBe(true);
    expect(result.code).toBe(code);

    const updated = sm.getSession(code);
    expect(updated.expiresAt).toBeGreaterThan(before + 1_000_000);
  });

  it('updates socketId to the new connection', () => {
    const { sessionId, deviceId, resumeToken, code } = sm.createSession('socket-1');
    sm.resumeSession(sessionId, deviceId, resumeToken, 'socket-new');

    const session = sm.getSession(code);
    const device = session.devices.find(d => d.deviceId === deviceId);
    expect(device.socketId).toBe('socket-new');
    expect(device.status).toBe('connected');
  });

  it('marks device back as connected after temporary disconnect', () => {
    const { sessionId, deviceId, resumeToken, code } = sm.createSession('socket-1');
    sm.removeDevice('socket-1');

    const session = sm.getSession(code);
    const device = session.devices.find(d => d.deviceId === deviceId);
    expect(device.status).toBe('temporarily_disconnected');

    sm.resumeSession(sessionId, deviceId, resumeToken, 'socket-1b');
    expect(device.status).toBe('connected');
  });

  it('rejects resume with wrong token', () => {
    const { sessionId, deviceId } = sm.createSession('socket-1');
    const result = sm.resumeSession(sessionId, deviceId, 'wrong-token-xxxx', 'socket-2');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid resume token/i);
  });

  it('rejects resume with unknown sessionId', () => {
    const result = sm.resumeSession('no-such-id', 'device-x', 'token-x', 'socket-2');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('rejects resume when session is expired', () => {
    const { sessionId, deviceId, resumeToken, code } = sm.createSession('socket-1');
    sm.getSession(code).expiresAt = Date.now() - 1;

    const result = sm.resumeSession(sessionId, deviceId, resumeToken, 'socket-2');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('provides correct connected device count after resume', () => {
    const { code, sessionId, deviceId, resumeToken } = sm.createSession('socket-1');
    sm.joinSession(code, 'socket-2');
    sm.removeDevice('socket-1');

    const result = sm.resumeSession(sessionId, deviceId, resumeToken, 'socket-1b');
    expect(result.success).toBe(true);
    expect(result.deviceCount).toBe(2);
  });
});

// ─── Device Disconnect / Reconnect Lifecycle ─────────────────────────────────

describe('removeDevice — temporary disconnect (grace period)', () => {
  it('marks device as temporarily_disconnected rather than removing', () => {
    const { code } = sm.createSession('socket-1');
    sm.removeDevice('socket-1');

    const session = sm.getSession(code);
    const device = session.devices.find(d => d.socketId === 'socket-1');
    expect(device.status).toBe('temporarily_disconnected');
    expect(session).not.toBeNull();
  });

  it('returns connected peer socket IDs for broadcast', () => {
    const { code } = sm.createSession('socket-1');
    sm.joinSession(code, 'socket-2');

    const { peerSocketIds } = sm.removeDevice('socket-1');
    expect(peerSocketIds).toContain('socket-2');
  });

  it('session persists after all devices temporarily disconnect', () => {
    const { code } = sm.createSession('socket-1');
    sm.joinSession(code, 'socket-2');
    sm.removeDevice('socket-1');
    sm.removeDevice('socket-2');

    expect(sm.getSession(code)).not.toBeNull();
  });
});

describe('permanentlyRemoveDevice — explicit leave', () => {
  it('fully removes device from session', () => {
    const { code } = sm.createSession('socket-1');
    sm.permanentlyRemoveDevice('socket-1');

    const session = sm.getSession(code);
    expect(session).toBeNull();
  });

  it('destroys session when last device leaves', () => {
    const { code } = sm.createSession('socket-1');
    sm.joinSession(code, 'socket-2');
    sm.permanentlyRemoveDevice('socket-1');
    sm.permanentlyRemoveDevice('socket-2');

    expect(sm.getSession(code)).toBeNull();
  });
});

// ─── TTL Cleanup ─────────────────────────────────────────────────────────────

describe('cleanExpiredSessions — TTL enforcement', () => {
  it('removes expired sessions', () => {
    const { code } = sm.createSession('socket-1');
    sm.getSession(code).expiresAt = Date.now() - 1;

    const cleaned = sm.cleanExpiredSessions();
    expect(cleaned).toBe(1);
    expect(sm.getSession(code)).toBeNull();
  });

  it('does not remove active sessions', () => {
    const { code } = sm.createSession('socket-1');
    const cleaned = sm.cleanExpiredSessions();
    expect(cleaned).toBe(0);
    expect(sm.getSession(code)).not.toBeNull();
  });

  it('evicts stale disconnected devices after 1 minute', () => {
    const { code } = sm.createSession('socket-1');
    sm.joinSession(code, 'socket-2');
    sm.removeDevice('socket-2');

    const session = sm.getSession(code);
    const disconnected = session.devices.find(d => d.socketId === 'socket-2');
    disconnected.lastSeen = Date.now() - 61_000;

    sm.cleanExpiredSessions();

    const updated = sm.getSession(code);
    expect(updated.devices).toHaveLength(1);
    expect(updated.devices[0].socketId).toBe('socket-1');
  });

  it('destroys session when all devices are evicted', () => {
    const { code } = sm.createSession('socket-1');
    sm.removeDevice('socket-1');

    const session = sm.getSession(code);
    session.devices[0].lastSeen = Date.now() - 61_000;

    sm.cleanExpiredSessions();
    expect(sm.getSession(code)).toBeNull();
  });

  it('keeps recently-disconnected devices within the grace window', () => {
    const { code } = sm.createSession('socket-1');
    sm.removeDevice('socket-1');

    sm.cleanExpiredSessions();
    expect(sm.getSession(code)).not.toBeNull();
  });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('reports correct session and device counts', () => {
    sm.createSession('socket-1');
    const { code } = sm.createSession('socket-2');
    sm.joinSession(code, 'socket-3');

    const stats = sm.getStats();
    expect(stats.activeSessions).toBe(2);
    expect(stats.totalDevices).toBe(3);
  });

  it('excludes temporarily_disconnected devices from active count', () => {
    const { code } = sm.createSession('socket-1');
    sm.joinSession(code, 'socket-2');
    sm.removeDevice('socket-2');

    const stats = sm.getStats();
    expect(stats.totalDevices).toBe(1);
  });
});
