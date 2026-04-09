/**
 * Clippy — Main Application Logic
 * Orchestrates WebSocket events, UI state, and user interactions.
 */
(() => {
  // App state
  const state = {
    view: 'home',       // home | waiting | connected
    sessionCode: null,
    socketId: null,
    ttlInterval: null,
    sessionCreatedAt: null,
    sessionTTL: 300000,  // 5 minutes
  };

  // ── localStorage helpers (RF-09) ─────────────────────────
  const STORAGE_KEY = 'clippy_session';

  function saveSessionToStorage(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        session_id: data.sessionId,
        device_id: data.deviceId,
        resume_token: data.resumeToken,
        code: data.code,
        expires_at: Date.now() + state.sessionTTL,
      }));
    } catch (e) { /* private browsing */ }
  }

  function loadSessionFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() > data.expires_at) {
        clearSessionStorage();
        return null;
      }
      return data;
    } catch (e) { return null; }
  }

  function clearSessionStorage() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* */ }
  }

  /**
   * Initialize the app.
   */
  function init() {
    UI.init();
    bindEvents();
    WS.setupAutoReconnect();
    WS.connect();
    setupWSListeners();
  }

  /**
   * Bind UI event handlers.
   */
  function bindEvents() {
    const els = UI.els();

    // Create Session
    els.btnCreate.addEventListener('click', () => {
      WS.send({ type: 'create_session' });
    });

    // Join Session — code input
    els.inputCode.addEventListener('input', (e) => {
      let val = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');

      // Auto-insert hyphen after 3 characters
      if (val.length === 3 && !val.includes('-')) {
        val = val + '-';
      }

      // Keep max 7 characters (ABC-12K)
      val = val.substring(0, 7);
      e.target.value = val;

      // Enable join button when code is complete
      UI.setJoinEnabled(val.length === 7 && /^[A-Z]{3}-[0-9]{2}[A-Z]$/.test(val));
    });

    // Join Session — submit
    els.btnJoin.addEventListener('click', () => {
      const code = UI.getCodeInput();
      if (code) {
        WS.send({ type: 'join_session', code });
      }
    });

    // Join on Enter key
    els.inputCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !els.btnJoin.disabled) {
        els.btnJoin.click();
      }
    });

    // Copy session code
    els.btnCopyCode.addEventListener('click', () => {
      if (state.sessionCode) {
        UI.copyToClipboard(state.sessionCode, els.btnCopyCode);
      }
    });

    // Cancel waiting
    els.btnCancelWaiting.addEventListener('click', () => {
      cancelSession();
    });

    // Send clip
    els.btnSend.addEventListener('click', () => {
      sendClip();
    });

    // Send on Ctrl+Enter / Cmd+Enter
    els.inputClip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        sendClip();
      }
    });

    // Disconnect
    els.btnDisconnect.addEventListener('click', () => {
      cancelSession();
    });
  }

  /**
   * Set up WebSocket event listeners.
   */
  function setupWSListeners() {
    // Connection events
    WS.on('ws_open', () => {
      UI.setStatus('connected', 'Connected to server');
    });

    WS.on('ws_close', () => {
      UI.setStatus('disconnected', 'Disconnected');
    });

    WS.on('reconnecting', (data) => {
      UI.setStatus('disconnected', `Reconnecting (${data.attempt}/${data.maxAttempts})...`);
    });

    WS.on('reconnect_failed', () => {
      UI.setStatus('disconnected', 'Connection failed');
      UI.showToast('Unable to connect to server. Please refresh.', 'error', 5000);
    });

    WS.on('connection_error', () => {
      UI.setStatus('disconnected', 'Connection error');
    });

    // Server welcome
    WS.on('connected', (data) => {
      state.socketId = data.socketId;
      UI.setStatus('connected', 'Ready');

      // If not already in a session, try to resume from localStorage
      if (state.view === 'home') {
        const stored = loadSessionFromStorage();
        if (stored) {
          WS.setResumeCredentials({
            sessionId: stored.session_id,
            deviceId: stored.device_id,
            resumeToken: stored.resume_token,
          });
          WS.tryResumeSession();
        }
      }
    });

    // Session created
    WS.on('session_created', (data) => {
      state.sessionCode = data.code;
      state.sessionCreatedAt = Date.now();
      state.view = 'waiting';

      UI.showCode(data.code);
      UI.showView('waiting');
      startTTLTimer();

      UI.showToast('Session created! Share the code.', 'success');

      // Persist credentials for reconnection (RF-09)
      saveSessionToStorage(data);
      WS.setResumeCredentials({
        sessionId: data.sessionId,
        deviceId: data.deviceId,
        resumeToken: data.resumeToken,
      });
    });

    // Session joined
    WS.on('session_joined', (data) => {
      state.sessionCode = data.code;
      state.view = 'connected';

      clearTTLTimer();
      UI.setConnectedCode(data.code);
      UI.clearFeed();
      UI.showView('connected');
      UI.setStatus('connected', 'Synced with peer');
      UI.showToast('Connected to session!', 'success');

      // Persist credentials for reconnection (RF-09)
      saveSessionToStorage(data);
      WS.setResumeCredentials({
        sessionId: data.sessionId,
        deviceId: data.deviceId,
        resumeToken: data.resumeToken,
      });
    });

    // Device connected — transitions host from waiting → connected (GAP #5)
    WS.on('device_connected', (data) => {
      if (state.view === 'waiting') {
        state.view = 'connected';
        clearTTLTimer();
        UI.setConnectedCode(state.sessionCode);
        UI.clearFeed();
        UI.showView('connected');
        UI.setStatus('connected', `Synced · ${data.devices} device${data.devices > 1 ? 's' : ''}`);
        UI.showToast('A device has connected!', 'success');
      } else {
        UI.setStatus('connected', `Synced · ${data.devices} device${data.devices > 1 ? 's' : ''}`);
        UI.showToast('Another device connected!', 'info');
      }
    });

    // Session resumed after reconnection
    WS.on('session_resumed', (data) => {
      state.sessionCode = data.code;
      state.view = 'connected';

      clearTTLTimer();
      UI.setConnectedCode(data.code);
      UI.showView('connected');
      UI.setStatus('connected', `Synced · ${data.devices} device${data.devices > 1 ? 's' : ''}`);
      UI.showToast('Session resumed!', 'success');
    });

    // Clip received
    WS.on('receive_clip', (data) => {
      UI.addClipToFeed(data.content, data.timestamp);
      UI.showToast('New clip received!', 'info', 2000);
    });

    // Clip sent confirmation
    WS.on('clip_sent', () => {
      UI.clearClipInput();
      UI.showToast('Sent!', 'success', 1500);
    });

    // Peer disconnected
    WS.on('peer_disconnected', () => {
      UI.showToast('The other device has disconnected.', 'error', 4000);
      UI.setStatus('connected', 'Peer disconnected');
      resetToHome();
    });

    // Session expired
    WS.on('session_expired', () => {
      clearSessionStorage();
      WS.clearResumeCredentials();
      UI.showToast('Session expired.', 'error', 4000);
      resetToHome();
    });

    // Server shutdown
    WS.on('server_shutdown', () => {
      UI.showToast('Server is shutting down.', 'error', 5000);
      UI.setStatus('disconnected', 'Server offline');
    });

    // Errors
    WS.on('error', (data) => {
      UI.showToast(data.message || 'An error occurred', 'error');
    });
  }

  /**
   * Send the clip text.
   */
  function sendClip() {
    const content = UI.getClipInput();
    if (!content.trim()) {
      UI.showToast('Nothing to send', 'error', 2000);
      return;
    }

    const sent = WS.send({
      type: 'send_clip',
      content: content,
    });

    if (!sent) {
      UI.showToast('Not connected. Cannot send.', 'error');
    }
  }

  /**
   * Cancel the current session and return to home.
   */
  function cancelSession() {
    clearSessionStorage();
    WS.clearResumeCredentials();
    WS.disconnect();
    resetToHome();

    // Reconnect for a fresh start
    setTimeout(() => {
      WS.connect();
    }, 300);
  }

  /**
   * Reset the app to the home view.
   */
  function resetToHome() {
    state.view = 'home';
    state.sessionCode = null;
    state.sessionCreatedAt = null;
    clearTTLTimer();

    UI.showView('home');
    UI.clearFeed();

    // Clear inputs
    const els = UI.els();
    els.inputCode.value = '';
    els.inputClip.value = '';
    UI.setJoinEnabled(false);
  }

  /**
   * Start the TTL countdown timer for the waiting view.
   */
  function startTTLTimer() {
    clearTTLTimer();
    const total = state.sessionTTL;
    const startedAt = state.sessionCreatedAt;

    state.ttlInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, total - elapsed);

      UI.updateTTL(remaining, total);

      if (remaining <= 0) {
        clearTTLTimer();
        UI.showToast('Session code expired.', 'error');
        resetToHome();
      }
    }, 1000);

    // Initial update
    UI.updateTTL(total, total);
  }

  /**
   * Clear the TTL timer.
   */
  function clearTTLTimer() {
    if (state.ttlInterval) {
      clearInterval(state.ttlInterval);
      state.ttlInterval = null;
    }
  }

  // Start the app
  document.addEventListener('DOMContentLoaded', init);
})();
