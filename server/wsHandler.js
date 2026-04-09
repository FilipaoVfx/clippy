const { generateId } = require('./utils');
const {
  checkRateLimit,
  sanitizeText,
  validateMessage,
  validateCode,
} = require('./security');
const sessionManager = require('./sessionManager');

/**
 * Handle a new WebSocket connection.
 */
function handleConnection(ws, req) {
  const socketId = generateId();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  ws._clippy = { socketId, ip };

  send(ws, {
    type: 'connected',
    socketId,
  });

  ws.on('message', (raw) => {
    try {
      if (!checkRateLimit(ip)) {
        send(ws, { type: 'error', message: 'Rate limit exceeded. Please slow down.' });
        return;
      }

      const data = JSON.parse(raw.toString());
      handleMessage(ws, socketId, data);
    } catch (err) {
      send(ws, { type: 'error', message: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    handleDisconnect(socketId);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error for ${socketId}:`, err.message);
    handleDisconnect(socketId);
  });
}

/**
 * Route incoming messages.
 */
function handleMessage(ws, socketId, data) {
  const { type } = data;

  switch (type) {
    case 'create_session':
      handleCreateSession(ws, socketId);
      break;
    case 'join_session':
      handleJoinSession(ws, socketId, data);
      break;
    case 'resume_session':
      handleResumeSession(ws, socketId, data);
      break;
    case 'send_clip':
      handleSendClip(ws, socketId, data);
      break;
    case 'leave_session':
      handleLeaveSession(ws, socketId);
      break;
    default:
      send(ws, { type: 'error', message: `Unknown event type: ${type}` });
  }
}

/**
 * Handle session creation.
 */
function handleCreateSession(ws, socketId) {
  const existing = sessionManager.getCodeBySocket(socketId);
  if (existing) {
    send(ws, { type: 'error', message: 'You are already in a session' });
    return;
  }

  const { code, sessionId, deviceId, resumeToken } = sessionManager.createSession(socketId);
  sessionManager.registerSocket(socketId, ws);

  send(ws, {
    type: 'session_created',
    code,
    sessionId,
    deviceId,
    resumeToken,
  });

  console.log(`[Session] Created: ${code} by ${socketId.substring(0, 8)}...`);
}

/**
 * Handle session join.
 */
function handleJoinSession(ws, socketId, data) {
  const { code } = data;

  if (!code || !validateCode(code.toUpperCase())) {
    send(ws, { type: 'error', message: 'Invalid code format. Use format: ABC-12K' });
    return;
  }

  const normalizedCode = code.toUpperCase();
  const result = sessionManager.joinSession(normalizedCode, socketId);

  if (!result.success) {
    send(ws, { type: 'error', message: result.error });
    return;
  }

  sessionManager.registerSocket(socketId, ws);

  // Notify the joiner
  send(ws, {
    type: 'session_joined',
    code: normalizedCode,
    sessionId: result.session.sessionId,
    deviceId: result.deviceId,
    resumeToken: result.resumeToken,
    devices: result.deviceCount || result.session.devices.length,
    role: 'guest',
  });

  // Notify all other connected devices
  const peerSockets = sessionManager.getPeerSockets(socketId);
  for (const peerWs of peerSockets) {
    send(peerWs, {
      type: 'device_connected',
      code: normalizedCode,
      devices: result.session.devices.length,
    });
  }

  console.log(`[Session] Joined: ${normalizedCode} by ${socketId.substring(0, 8)}...`);
}

/**
 * Handle session resume.
 */
function handleResumeSession(ws, socketId, data) {
  const { sessionId, deviceId, resumeToken } = data;

  if (!sessionId || !deviceId || !resumeToken) {
    send(ws, { type: 'error', message: 'Missing resume credentials' });
    return;
  }

  const result = sessionManager.resumeSession(sessionId, deviceId, resumeToken, socketId);

  if (!result.success) {
    send(ws, { type: 'error', message: result.error });
    return;
  }

  sessionManager.registerSocket(socketId, ws);

  send(ws, {
    type: 'session_resumed',
    code: result.code,
    sessionId,
    deviceId,
    devices: result.deviceCount,
  });

  // Notify other devices
  const peerSockets = sessionManager.getPeerSockets(socketId);
  for (const peerWs of peerSockets) {
    send(peerWs, {
      type: 'device_connected',
      code: result.code,
      devices: result.deviceCount,
    });
  }

  console.log(`[Session] Resumed: ${result.code} device ${deviceId.substring(0, 8)}...`);
}

/**
 * Handle sending a clipboard clip.
 */
function handleSendClip(ws, socketId, data) {
  const { content } = data;

  const validation = validateMessage(content);
  if (!validation.valid) {
    send(ws, { type: 'error', message: validation.error });
    return;
  }

  const session = sessionManager.getSessionBySocket(socketId);
  if (!session) {
    send(ws, { type: 'error', message: 'Not in a session' });
    return;
  }

  const sanitized = sanitizeText(content);
  const peerSockets = sessionManager.getPeerSockets(socketId);

  if (peerSockets.length === 0) {
    send(ws, { type: 'error', message: 'No connected peers' });
    return;
  }

  const timestamp = Date.now();

  for (const peerWs of peerSockets) {
    send(peerWs, {
      type: 'receive_clip',
      content: sanitized,
      timestamp,
    });
  }

  send(ws, {
    type: 'clip_sent',
    timestamp,
  });
}

/**
 * Handle leaving a session.
 */
function handleLeaveSession(ws, socketId) {
  const { peerSocketIds, sessionDestroyed } = sessionManager.permanentlyRemoveDevice(socketId);

  for (const peerSocketId of peerSocketIds) {
    const session = sessionManager.getSessionBySocket(peerSocketId);
    if (session) {
      const peerWs = session.sockets.get(peerSocketId);
      if (peerWs) {
        send(peerWs, {
          type: 'device_disconnected',
          devices: session.devices.filter(d => d.status === 'connected').length,
        });
      }
    }
  }

  if (sessionDestroyed) {
    send(ws, { type: 'session_left' });
  }

  console.log(`[WS] Left session: ${socketId.substring(0, 8)}...`);
}

/**
 * Handle device disconnection.
 */
function handleDisconnect(socketId) {
  const { peerSocketIds, sessionDestroyed } = sessionManager.removeDevice(socketId);

  for (const peerSocketId of peerSocketIds) {
    const session = sessionManager.getSessionBySocket(peerSocketId);
    if (session) {
      const peerWs = session.sockets.get(peerSocketId);
      if (peerWs) {
        send(peerWs, {
          type: 'device_disconnected',
          devices: session.devices.filter(d => d.status === 'connected').length,
        });
      }
    }
  }

  console.log(`[WS] Disconnected: ${socketId.substring(0, 8)}...`);
}

/**
 * Send a JSON message to a WebSocket.
 */
function send(ws, data) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  } catch (err) {
    console.error('[WS] Send error:', err.message);
  }
}

module.exports = { handleConnection };
