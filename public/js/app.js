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
    pendingIntent: null, // what to do once the socket is up
    createRetries: 0,    // guards against a code-collision loop
  };

  // ── Session codes (RF-02) ────────────────────────────────
  // Sessions are sharded server-side by code, so the code has to exist before
  // connecting. The client picks it and the server rejects collisions, which
  // keeps pairing to a single connection with no reconnect round-trip.
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, they read as 1/0
  const CODE_DIGITS = '0123456789';
  const MAX_CODE_RETRIES = 5;

  function pick(alphabet) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return alphabet[values[0] % alphabet.length];
  }

  function generateCode() {
    return (
      pick(CODE_LETTERS) + pick(CODE_LETTERS) + pick(CODE_LETTERS) + '-' +
      pick(CODE_DIGITS) + pick(CODE_DIGITS) + pick(CODE_LETTERS)
    );
  }

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
    setupWSListeners();
    restoreOrIdle();
  }

  /**
   * Connect only when there is a session to connect to.
   *
   * Sessions are sharded by code, so there is nothing to connect to before one
   * exists — and not opening a socket on every page load avoids spinning up a
   * Durable Object for visitors who never pair.
   */
  const CODE_PATTERN = /^[A-Z]{3}-[0-9]{2}[A-Z]$/;

  /**
   * A code in the URL means we got here from a scanned pairing QR.
   * Consumed once and stripped, so a refresh does not re-trigger the join.
   */
  function codeFromUrl() {
    const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
    if (!CODE_PATTERN.test(code)) return null;

    const url = new URL(location.href);
    url.searchParams.delete('code');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    return code;
  }

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  /**
   * Whether this device already has Clippy installed.
   *
   * There is no web API to detect this from the *other* device, nor to launch
   * an installed PWA from a browser tab — the most we can do is notice it here
   * and point the user at it. Chromium-only; everywhere else this is false.
   */
  async function isAppInstalled() {
    if (!navigator.getInstalledRelatedApps) return false;
    try {
      const apps = await navigator.getInstalledRelatedApps();
      return apps.some((app) => app.platform === 'webapp');
    } catch (err) {
      return false;
    }
  }

  async function maybeSuggestApp() {
    if (isStandalone()) return; // already running as the app
    if (await isAppInstalled()) {
      UI.showToast('You have Clippy installed — open it for the full app.', 'info', 5000);
    }
  }

  function restoreOrIdle() {
    // A scanned QR wins over a stored session: the user just asked for this one.
    const scanned = codeFromUrl();
    if (scanned) {
      maybeSuggestApp();
      clearSessionStorage();
      startJoinSession(scanned);
      return;
    }

    const stored = loadSessionFromStorage();
    if (stored && stored.code) {
      WS.setResumeCredentials({
        sessionId: stored.session_id,
        deviceId: stored.device_id,
        resumeToken: stored.resume_token,
      });
      UI.setStatus('idle', 'Reconnecting...');
      WS.connect(stored.code); // resume is sent automatically once open
      return;
    }
    UI.setStatus('idle', 'Ready to pair');
  }

  /** Start a brand new session under a locally generated code. */
  function startCreateSession() {
    const code = generateCode();
    WS.clearResumeCredentials(); // a stale token would trigger a resume instead
    state.pendingIntent = { type: 'create' };
    UI.setStatus('idle', 'Creating session...');
    WS.disconnect();
    WS.connect(code);
  }

  /** Join an existing session by its code. */
  function startJoinSession(code) {
    WS.clearResumeCredentials();
    state.pendingIntent = { type: 'join', code };
    UI.setStatus('idle', 'Joining...');
    WS.disconnect();
    WS.connect(code);
  }

  // ── Image transfer helpers (RF-13) ──────────────────────
  const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

  function sendImageFile(file) {
    if (!file || !ALLOWED_IMAGE_TYPES.has(file.type)) {
      UI.showToast('Unsupported format. Use PNG, JPG, or WEBP.', 'error');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      UI.showToast('Image exceeds 5 MB limit.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUri = e.target.result;
      const sent = WS.send({ type: 'send_image', data: dataUri });
      if (!sent) {
        UI.showToast('Not connected. Cannot send image.', 'error');
      }
    };
    reader.onerror = () => UI.showToast('Failed to read image file.', 'error');
    reader.readAsDataURL(file);
  }

  // ── Chunked video transfer (RF-15) ──────────────────────
  const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
  const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
  const CHUNK_SIZE = 512 * 1024;
  const FRAME_VERSION = 1;
  const HEADER_BYTES = 21;
  // Chunks in flight before waiting for an ack. Caps what the relay has to hold
  // for a slow receiver, and what we lose if the connection drops.
  const WINDOW = 8;
  const ACK_EVERY = 4;
  const BUFFER_LIMIT = 2 * 1024 * 1024;

  let outgoing = null;  // transfer we are sending
  let incoming = null;  // transfer we are receiving

  function randomTransferId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function buildFrame(transferId, index, payload) {
    const frame = new Uint8Array(HEADER_BYTES + payload.byteLength);
    frame[0] = FRAME_VERSION;
    for (let i = 0; i < 16; i += 1) {
      frame[1 + i] = parseInt(transferId.substr(i * 2, 2), 16);
    }
    new DataView(frame.buffer).setUint32(17, index, false);
    frame.set(new Uint8Array(payload), HEADER_BYTES);
    return frame.buffer;
  }

  function sendVideoFile(file) {
    if (outgoing) {
      UI.showToast('Another video is already being sent.', 'error');
      return;
    }
    if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
      UI.showToast('Unsupported format. Use MP4, WEBM or MOV.', 'error');
      return;
    }
    if (file.size > VIDEO_MAX_BYTES) {
      UI.showToast('Video exceeds 50 MB limit.', 'error');
      return;
    }

    const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
    outgoing = {
      id: randomTransferId(),
      file,
      chunkCount,
      nextChunk: 0,
      ackedUpTo: -1,
      started: false,
    };

    const ok = WS.send({
      type: 'transfer_start',
      transferId: outgoing.id,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      chunkSize: CHUNK_SIZE,
      chunkCount,
    });

    if (!ok) {
      outgoing = null;
      UI.showToast('Not connected. Cannot send.', 'error');
      return;
    }

    UI.showTransferProgress('Sending', 0);
  }

  /**
   * Push chunks until the ack window (or the socket buffer) says to wait.
   * Resumes when the next ack arrives.
   */
  async function pumpChunks() {
    if (!outgoing) return;

    while (
      outgoing.nextChunk < outgoing.chunkCount &&
      outgoing.nextChunk - outgoing.ackedUpTo <= WINDOW &&
      WS.bufferedAmount() < BUFFER_LIMIT
    ) {
      const index = outgoing.nextChunk;
      const start = index * CHUNK_SIZE;
      const blob = outgoing.file.slice(start, Math.min(start + CHUNK_SIZE, outgoing.file.size));

      let payload;
      try {
        payload = await blob.arrayBuffer();
      } catch (err) {
        abortOutgoing('Could not read the file');
        return;
      }
      if (!outgoing || outgoing.nextChunk !== index) return; // aborted while reading

      if (!WS.sendBinary(buildFrame(outgoing.id, index, payload))) {
        abortOutgoing('Connection lost');
        return;
      }

      outgoing.nextChunk += 1;
      UI.showTransferProgress('Sending', outgoing.nextChunk / outgoing.chunkCount);
    }

    if (outgoing && outgoing.nextChunk >= outgoing.chunkCount) {
      WS.send({ type: 'transfer_end', transferId: outgoing.id });
    }
  }

  function abortOutgoing(reason) {
    if (!outgoing) return;
    WS.send({ type: 'transfer_abort', transferId: outgoing.id, reason });
    outgoing = null;
    UI.hideTransferProgress();
    UI.showToast(reason, 'error');
  }

  /** Drop any partial transfer and release its memory. */
  function discardIncoming() {
    if (!incoming) return;
    incoming.chunks = null;
    incoming = null;
    UI.hideTransferProgress();
  }

  /**
   * Bind UI event handlers.
   */
  function bindEvents() {
    const els = UI.els();

    // Create Session
    els.btnCreate.addEventListener('click', () => {
      state.createRetries = 0;
      startCreateSession();
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
        startJoinSession(code);
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

    // Image — browse button triggers hidden file input
    const inputImage = document.getElementById('input-image');
    const btnSendImage = document.getElementById('btn-send-image');
    const dropZone = document.getElementById('image-drop-zone');

    btnSendImage.addEventListener('click', () => inputImage.click());

    inputImage.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) sendImageFile(file);
      inputImage.value = '';
    });

    // Drag-and-drop on the drop zone
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) sendImageFile(file);
    });

    // Video — browse, and drag-and-drop
    const inputVideo = document.getElementById('input-video');
    const btnSendVideo = document.getElementById('btn-send-video');
    const videoZone = document.getElementById('video-drop-zone');

    btnSendVideo.addEventListener('click', () => inputVideo.click());

    inputVideo.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) sendVideoFile(file);
      inputVideo.value = '';
    });

    videoZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      videoZone.classList.add('drag-over');
    });
    videoZone.addEventListener('dragleave', () => videoZone.classList.remove('drag-over'));
    videoZone.addEventListener('drop', (e) => {
      e.preventDefault();
      videoZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) sendVideoFile(file);
    });

    // Global paste — grab image from clipboard when connected
    document.addEventListener('paste', (e) => {
      if (state.view !== 'connected') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { sendImageFile(file); break; }
        }
      }
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

    // Server welcome — act on whatever we connected in order to do
    WS.on('connected', (data) => {
      state.socketId = data.socketId;

      const intent = state.pendingIntent;
      state.pendingIntent = null;

      if (!intent) {
        // No intent means this is a reconnect; ws.js re-sends resume itself.
        UI.setStatus('connected', 'Connected');
        return;
      }

      if (intent.type === 'create') {
        WS.send({ type: 'create_session' });
      } else if (intent.type === 'join') {
        WS.send({ type: 'join_session', code: intent.code });
      }
    });

    // The code we picked was already taken — pick another and retry.
    WS.on('code_taken', () => {
      if (state.createRetries >= MAX_CODE_RETRIES) {
        UI.showToast('Could not start a session. Please try again.', 'error');
        resetToHome();
        return;
      }
      state.createRetries += 1;
      startCreateSession();
    });

    // Session created
    WS.on('session_created', (data) => {
      state.sessionCode = data.code;
      state.sessionCreatedAt = Date.now();
      state.view = 'waiting';

      UI.showCode(data.code);
      // Scanning this opens the app on the other device with the code already
      // filled in, so pairing needs no typing.
      UI.showPairingQR(`${location.origin}/?code=${encodeURIComponent(data.code)}`);
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

    // ── Chunked video transfer (RF-15) ──────────────────────

    // Receiver: a transfer is being announced.
    WS.on('transfer_incoming', (data) => {
      discardIncoming();
      incoming = {
        id: data.transferId,
        name: data.name,
        mimeType: data.mimeType,
        size: data.size,
        chunkCount: data.chunkCount,
        chunks: new Array(data.chunkCount),
        received: 0,
      };
      UI.showTransferProgress('Receiving', 0);
      WS.send({ type: 'transfer_ready', transferId: data.transferId });
    });

    // Receiver: a chunk arrived. Acknowledge so the sender's window advances.
    WS.on('binary_chunk', (buffer) => {
      if (!incoming) return;

      const view = new Uint8Array(buffer);
      if (view.byteLength <= HEADER_BYTES || view[0] !== FRAME_VERSION) return;

      let id = '';
      for (let i = 0; i < 16; i += 1) id += view[1 + i].toString(16).padStart(2, '0');
      if (id !== incoming.id) return;

      const index = new DataView(buffer).getUint32(17, false);
      if (index >= incoming.chunkCount || incoming.chunks[index]) return;

      incoming.chunks[index] = view.slice(HEADER_BYTES);
      incoming.received += 1;
      UI.showTransferProgress('Receiving', incoming.received / incoming.chunkCount);

      // Ack every few chunks rather than every one: the window is wide enough
      // that per-chunk acks are pure overhead.
      const isLast = incoming.received === incoming.chunkCount;
      if (isLast || incoming.received % ACK_EVERY === 0) {
        WS.send({ type: 'transfer_ack', transferId: incoming.id, upTo: index });
      }
    });

    // Sender: the window advanced, keep pushing.
    WS.on('transfer_ack', (data) => {
      if (!outgoing || data.transferId !== outgoing.id) return;
      outgoing.ackedUpTo = Math.max(outgoing.ackedUpTo, data.upTo);
      pumpChunks();
    });

    // Sender: the peer is ready, start pushing.
    WS.on('transfer_ready', (data) => {
      if (!outgoing || data.transferId !== outgoing.id || outgoing.started) return;
      outgoing.started = true;
      pumpChunks();
    });

    // Every byte arrived. Both ends get this: the sender clears its progress,
    // the receiver assembles the blob.
    WS.on('transfer_complete', (data) => {
      if (outgoing && data.transferId === outgoing.id) {
        outgoing = null;
        UI.hideTransferProgress();
        UI.showToast('Video sent!', 'success', 1500);
        return;
      }

      if (!incoming || data.transferId !== incoming.id) return;

      if (incoming.received !== incoming.chunkCount) {
        UI.showToast('Video arrived incomplete.', 'error');
        discardIncoming();
        return;
      }

      const blob = new Blob(incoming.chunks, { type: incoming.mimeType });
      UI.addVideoToFeed(blob, incoming.name, Date.now());
      UI.showToast('Video received!', 'info', 2000);
      discardIncoming();
    });

    // Either side gave up.
    WS.on('transfer_aborted', (data) => {
      if (outgoing && data.transferId === outgoing.id) {
        outgoing = null;
        UI.hideTransferProgress();
        UI.showToast(data.reason || 'Transfer cancelled', 'error');
      }
      if (incoming && data.transferId === incoming.id) {
        discardIncoming();
        UI.showToast(data.reason || 'Transfer cancelled', 'error');
      }
    });

    // Image received (RF-13)
    WS.on('receive_image', (data) => {
      UI.addImageToFeed(data.data, data.mimeType, data.timestamp);
      UI.showToast('Image received!', 'info', 2000);
    });

    // Image sent confirmation
    WS.on('image_sent', () => {
      UI.showToast('Image sent!', 'success', 1500);
    });

    // Peer disconnected
    WS.on('peer_disconnected', () => {
      UI.showToast('The other device has disconnected.', 'error', 4000);
      UI.setStatus('connected', 'Peer disconnected');
      resetToHome();
    });

    WS.on('device_disconnected', (data) => {
      UI.showToast('A device disconnected.', 'info', 2500);
      if (state.view === 'connected') {
        const devices = typeof data?.devices === 'number' ? data.devices : 1;
        UI.setStatus('connected', `Synced - ${devices} device${devices > 1 ? 's' : ''}`);
      }
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

    // Nothing to reconnect to: the next session opens its own connection.
    UI.setStatus('idle', 'Ready to pair');
  }

  /**
   * Reset the app to the home view.
   */
  function resetToHome() {
    state.view = 'home';
    state.sessionCode = null;
    state.sessionCreatedAt = null;
    state.pendingIntent = null;
    clearTTLTimer();

    // Drop any transfer in flight and release its buffers. clearFeed() revokes
    // the object URLs, so nothing received outlives the session.
    outgoing = null;
    discardIncoming();

    UI.showView('home');
    UI.clearPairingQR();
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
