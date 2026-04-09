const { generateCode, generateId, generateResumeToken } = require('./utils');

const SESSION_TTL = parseInt(process.env.SESSION_TTL_MS || '1800000', 10); // 30 minutes
const DEVICE_DISCONNECT_TTL = 60000; // 1 minute before device is fully removed
const MAX_DEVICES = 5;

// Map<code, Session>
const sessions = new Map();
// Map<socketId, code>
const socketToSession = new Map();
// Map<deviceId, code>
const deviceToSession = new Map();

/**
 * Create a new ephemeral session.
 */
function createSession(socketId) {
  const existingCodes = new Set(sessions.keys());
  const code = generateCode(existingCodes);
  const sessionId = generateId();
  const deviceId = generateId();
  const resumeToken = generateResumeToken();
  const now = Date.now();

  const session = {
    sessionId,
    code,
    createdAt: now,
    expiresAt: now + SESSION_TTL,
    state: 'active',
    devices: [
      {
        deviceId,
        socketId,
        status: 'connected',
        resumeToken,
        lastSeen: now,
      },
    ],
    sockets: new Map(),
  };

  sessions.set(code, session);
  socketToSession.set(socketId, code);
  deviceToSession.set(deviceId, code);

  return { code, sessionId, deviceId, resumeToken };
}

/**
 * Join an existing session by code.
 */
function joinSession(code, socketId) {
  const session = sessions.get(code);

  if (!session) {
    return { success: false, error: 'Session not found or expired' };
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(code);
    return { success: false, error: 'Session has expired' };
  }

  if (session.state === 'expired') {
    return { success: false, error: 'Session has expired' };
  }

  const connectedDevices = session.devices.filter(d => d.status === 'connected').length;
  if (connectedDevices >= MAX_DEVICES) {
    return { success: false, error: `Session is full (max ${MAX_DEVICES} devices)` };
  }

  const deviceId = generateId();
  const resumeToken = generateResumeToken();
  const now = Date.now();

  session.devices.push({
    deviceId,
    socketId,
    status: 'connected',
    resumeToken,
    lastSeen: now,
  });

  socketToSession.set(socketId, code);
  deviceToSession.set(deviceId, code);
  session.expiresAt = now + SESSION_TTL;

  return { success: true, session, deviceId, resumeToken };
}

/**
 * Resume a session using stored credentials.
 */
function resumeSession(sessionId, deviceId, resumeToken, socketId) {
  for (const [code, session] of sessions) {
    if (session.sessionId !== sessionId) continue;
    if (Date.now() > session.expiresAt) {
      sessions.delete(code);
      return { success: false, error: 'Session has expired' };
    }

    const device = session.devices.find(d => d.deviceId === deviceId);
    if (!device) {
      return { success: false, error: 'Device not found in session' };
    }

    if (device.resumeToken !== resumeToken) {
      return { success: false, error: 'Invalid resume token' };
    }

    // Update socket reference and status
    const oldSocketId = device.socketId;
    socketToSession.delete(oldSocketId);

    device.socketId = socketId;
    device.status = 'connected';
    device.lastSeen = Date.now();

    socketToSession.set(socketId, code);
    session.expiresAt = Date.now() + SESSION_TTL;

    return {
      success: true,
      session,
      code,
      deviceCount: session.devices.filter(d => d.status === 'connected').length,
    };
  }

  return { success: false, error: 'Session not found' };
}

/**
 * Get a session by code.
 */
function getSession(code) {
  return sessions.get(code) || null;
}

/**
 * Get session by socket.
 */
function getSessionBySocket(socketId) {
  const code = socketToSession.get(socketId);
  if (!code) return null;
  return sessions.get(code) || null;
}

/**
 * Get session by device ID.
 */
function getSessionByDevice(deviceId) {
  const code = deviceToSession.get(deviceId);
  if (!code) return null;
  return sessions.get(code) || null;
}

/**
 * Get code by socket.
 */
function getCodeBySocket(socketId) {
  return socketToSession.get(socketId) || null;
}

/**
 * Remove a device from its session.
 */
function removeDevice(socketId) {
  const code = socketToSession.get(socketId);
  if (!code) return { peerSocketIds: [], sessionDestroyed: false };

  const session = sessions.get(code);
  socketToSession.delete(socketId);

  if (!session) return { peerSocketIds: [], sessionDestroyed: false };

  const device = session.devices.find(d => d.socketId === socketId);
  if (device) {
    device.status = 'temporarily_disconnected';
    device.lastSeen = Date.now();
  }

  const peerSocketIds = session.devices
    .filter(d => d.socketId !== socketId && d.status === 'connected')
    .map(d => d.socketId);

  return { peerSocketIds, sessionDestroyed: false };
}

/**
 * Permanently remove a device (after TTL or explicit leave).
 */
function permanentlyRemoveDevice(socketId) {
  const code = socketToSession.get(socketId);
  if (!code) return { peerSocketIds: [], sessionDestroyed: false };

  const session = sessions.get(code);
  socketToSession.delete(socketId);

  if (!session) return { peerSocketIds: [], sessionDestroyed: false };

  const deviceIdx = session.devices.findIndex(d => d.socketId === socketId);
  if (deviceIdx !== -1) {
    const device = session.devices[deviceIdx];
    deviceToSession.delete(device.deviceId);
    session.devices.splice(deviceIdx, 1);
  }

  if (session.devices.length === 0) {
    sessions.delete(code);
    return { peerSocketIds: [], sessionDestroyed: true };
  }

  const peerSocketIds = session.devices
    .filter(d => d.status === 'connected')
    .map(d => d.socketId);

  return { peerSocketIds, sessionDestroyed: false };
}

/**
 * Register a WebSocket reference for a device.
 */
function registerSocket(socketId, ws) {
  const code = socketToSession.get(socketId);
  if (!code) return;
  const session = sessions.get(code);
  if (!session) return;
  session.sockets.set(socketId, ws);
}

/**
 * Get all connected peer WebSockets for a given socketId.
 */
function getPeerSockets(socketId) {
  const code = socketToSession.get(socketId);
  if (!code) return [];

  const session = sessions.get(code);
  if (!session) return [];

  const peers = [];
  for (const [id, ws] of session.sockets) {
    if (id !== socketId && ws.readyState === 1) {
      peers.push(ws);
    }
  }
  return peers;
}

/**
 * Get device info for a socket.
 */
function getDeviceBySocket(socketId) {
  const code = socketToSession.get(socketId);
  if (!code) return null;
  const session = sessions.get(code);
  if (!session) return null;
  return session.devices.find(d => d.socketId === socketId) || null;
}

/**
 * Get connected device count for a session.
 */
function getConnectedDeviceCount(code) {
  const session = sessions.get(code);
  if (!session) return 0;
  return session.devices.filter(d => d.status === 'connected').length;
}

/**
 * Clean up expired sessions and stale disconnected devices.
 */
function cleanExpiredSessions() {
  const now = Date.now();
  let cleaned = 0;

  for (const [code, session] of sessions) {
    if (now > session.expiresAt) {
      for (const [socketId, ws] of session.sockets) {
        try {
          ws.send(JSON.stringify({ type: 'session_expired' }));
          ws.close(1000, 'Session expired');
        } catch (e) { /* ignore */ }
        socketToSession.delete(socketId);
      }
      for (const device of session.devices) {
        deviceToSession.delete(device.deviceId);
      }
      sessions.delete(code);
      cleaned++;
      continue;
    }

    // Clean up stale disconnected devices
    session.devices = session.devices.filter(device => {
      if (device.status === 'temporarily_disconnected' &&
          now - device.lastSeen > DEVICE_DISCONNECT_TTL) {
        deviceToSession.delete(device.deviceId);
        return false;
      }
      return true;
    });

    if (session.devices.length === 0) {
      sessions.delete(code);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get stats.
 */
function getStats() {
  let totalDevices = 0;
  for (const session of sessions.values()) {
    totalDevices += session.devices.filter(d => d.status === 'connected').length;
  }
  return {
    activeSessions: sessions.size,
    activeConnections: socketToSession.size,
    totalDevices: totalDevices,
  };
}

module.exports = {
  createSession,
  joinSession,
  resumeSession,
  getSession,
  getSessionBySocket,
  getSessionByDevice,
  getCodeBySocket,
  removeDevice,
  permanentlyRemoveDevice,
  registerSocket,
  getPeerSockets,
  getDeviceBySocket,
  getConnectedDeviceCount,
  cleanExpiredSessions,
  getStats,
  MAX_DEVICES,
};
