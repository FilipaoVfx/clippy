/**
 * Clippy — WebSocket Client Manager
 * Handles connection, reconnection, message routing, and auto-reconnect on focus/visibility/online.
 */
const WS = (() => {
  let socket = null;
  let listeners = {};
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let intentionalClose = false;
  let resumeCredentials = null;
  let isReconnecting = false;

  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_DELAY = 1000;

  /**
   * Connect to the WebSocket server.
   */
  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    intentionalClose = false;
    isReconnecting = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      socket = new WebSocket(url);
    } catch (err) {
      console.error('[WS] Connection error:', err);
      emit('connection_error', { message: err.message });
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      console.log('[WS] Connected');
      reconnectAttempts = 0;
      emit('ws_open');

      if (resumeCredentials && !isReconnecting) {
        tryResumeSession();
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        emit(data.type, data);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    socket.onclose = (event) => {
      console.log(`[WS] Closed: ${event.code} ${event.reason}`);
      emit('ws_close', { code: event.code, reason: event.reason });

      if (!intentionalClose) {
        scheduleReconnect();
      }
    };

    socket.onerror = (err) => {
      console.error('[WS] Error:', err);
      emit('connection_error', { message: 'Connection error' });
    };
  }

  /**
   * Try to resume session after reconnection.
   */
  function tryResumeSession() {
    if (!resumeCredentials) return;

    const { sessionId, deviceId, resumeToken } = resumeCredentials;
    if (!sessionId || !deviceId || !resumeToken) return;

    console.log('[WS] Attempting to resume session...');
    isReconnecting = true;
    send({
      type: 'resume_session',
      sessionId,
      deviceId,
      resumeToken,
    });
  }

  /**
   * Store resume credentials for auto-reconnection.
   */
  function setResumeCredentials(credentials) {
    resumeCredentials = credentials;
  }

  /**
   * Clear resume credentials.
   */
  function clearResumeCredentials() {
    resumeCredentials = null;
  }

  /**
   * Send a JSON message to the server.
   */
  function send(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Not connected, cannot send');
      return false;
    }

    try {
      socket.send(JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('[WS] Send error:', err);
      return false;
    }
  }

  /**
   * Disconnect intentionally.
   */
  function disconnect() {
    intentionalClose = true;
    clearTimeout(reconnectTimer);
    if (socket) {
      socket.close(1000, 'User disconnect');
      socket = null;
    }
  }

  /**
   * Schedule a reconnection with exponential backoff.
   */
  function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[WS] Max reconnect attempts reached');
      emit('reconnect_failed');
      return;
    }

    const delay = BASE_DELAY * Math.pow(2, reconnectAttempts);
    reconnectAttempts++;

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    emit('reconnecting', { attempt: reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS });

    reconnectTimer = setTimeout(() => {
      connect();
    }, delay);
  }

  /**
   * Register an event listener.
   */
  function on(event, callback) {
    if (!listeners[event]) {
      listeners[event] = [];
    }
    listeners[event].push(callback);
  }

  /**
   * Remove an event listener.
   */
  function off(event, callback) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(cb => cb !== callback);
  }

  /**
   * Emit an event to all registered listeners.
   */
  function emit(event, data) {
    if (!listeners[event]) return;
    listeners[event].forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error(`[WS] Listener error for ${event}:`, err);
      }
    });
  }

  /**
   * Check if connected.
   */
  function isConnected() {
    return socket && socket.readyState === WebSocket.OPEN;
  }

  /**
   * Set up auto-reconnect on browser events.
   */
  function setupAutoReconnect() {
    // Reconnect when tab regains focus
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && socket && socket.readyState !== WebSocket.OPEN && !intentionalClose) {
        console.log('[WS] Tab visible, attempting reconnect...');
        clearTimeout(reconnectTimer);
        reconnectAttempts = 0;
        connect();
      }
    });

    // Reconnect when browser comes back online
    window.addEventListener('online', () => {
      if (socket && socket.readyState !== WebSocket.OPEN && !intentionalClose) {
        console.log('[WS] Browser online, attempting reconnect...');
        clearTimeout(reconnectTimer);
        reconnectAttempts = 0;
        connect();
      }
    });

    // Reconnect when window regains focus
    window.addEventListener('focus', () => {
      if (socket && socket.readyState !== WebSocket.OPEN && !intentionalClose) {
        console.log('[WS] Window focused, attempting reconnect...');
        clearTimeout(reconnectTimer);
        reconnectAttempts = 0;
        connect();
      }
    });
  }

  return {
    connect,
    send,
    disconnect,
    on,
    off,
    isConnected,
    setResumeCredentials,
    clearResumeCredentials,
    tryResumeSession,
    setupAutoReconnect,
  };
})();
