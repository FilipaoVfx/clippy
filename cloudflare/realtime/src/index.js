import { DurableObject } from "cloudflare:workers";

const DEFAULTS = {
  sessionTtlMs: 300000,
  deviceDisconnectTtlMs: 60000,
  maxMessageSize: 10240,
  imageMaxBytes: 5 * 1024 * 1024,
  videoMaxBytes: 50 * 1024 * 1024,
  rateLimitMax: 30,
  rateLimitWindowMs: 60000,
  // Byte budget per window, refilled continuously. Bounds how fast a single
  // origin can push payload through the relay without capping burst latency
  // the way a message counter would.
  rateLimitBytes: 128 * 1024 * 1024,
  maxDevices: 5,
};

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

// Binary chunk framing (RF-15). The coordinator never parses the payload — it
// only reads this header to attribute the chunk, then relays the frame as-is.
//   byte  0      version
//   bytes 1..16  transferId
//   bytes 17..20 chunkIndex (uint32 big-endian)
//   bytes 21..   payload
const TRANSFER_FRAME_VERSION = 1;
const TRANSFER_HEADER_BYTES = 21;
const TRANSFER_ID_BYTES = 16;
const MAX_CHUNK_BYTES = 1024 * 1024;
const TRANSFER_FLOW_TYPES = new Set(["transfer_ack", "transfer_ready"]);

function hexFromBytes(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_DIGITS = "0123456789";

function createState() {
  return {
    sessionsByCode: {},
    sessionIds: {},
    deviceToSession: {},
  };
}

function readNumber(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function generateId() {
  return crypto.randomUUID();
}

function generateResumeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function generateCode(existingCodes) {
  let code = "";
  let attempts = 0;

  do {
    code =
      CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)] +
      CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)] +
      CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)] +
      "-" +
      CODE_DIGITS[Math.floor(Math.random() * CODE_DIGITS.length)] +
      CODE_DIGITS[Math.floor(Math.random() * CODE_DIGITS.length)] +
      CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    attempts += 1;
  } while (existingCodes.has(code) && attempts < 100);

  if (existingCodes.has(code)) {
    throw new Error("Failed to generate a unique session code.");
  }

  return code;
}

function validateCode(code) {
  return /^[A-Z]{3}-[0-9]{2}[A-Z]$/.test(code);
}

function validateImage(dataUri, maxBytes) {
  if (typeof dataUri !== "string") {
    return { valid: false, error: "Image data must be a string" };
  }

  const match = dataUri.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!match) {
    return { valid: false, error: "Invalid image format. Use PNG, JPG, or WEBP as a data URI." };
  }

  const mimeType = match[1];
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return { valid: false, error: "Unsupported format. Use PNG, JPG, or WEBP." };
  }

  const base64Data = match[2];
  const paddingChars = base64Data.endsWith("==") ? 2 : base64Data.endsWith("=") ? 1 : 0;
  const byteSize = (base64Data.length * 3) / 4 - paddingChars;

  if (byteSize > maxBytes) {
    return { valid: false, error: `Image exceeds ${Math.floor(maxBytes / (1024 * 1024))} MB limit` };
  }

  return { valid: true, mimeType };
}

function sanitizeText(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function validateMessage(content, maxMessageSize) {
  if (typeof content !== "string") {
    return { valid: false, error: "Content must be a string" };
  }

  if (content.length === 0) {
    return { valid: false, error: "Content cannot be empty" };
  }

  const byteSize = new TextEncoder().encode(content).length;
  if (byteSize > maxMessageSize) {
    return {
      valid: false,
      error: `Content exceeds maximum size of ${maxMessageSize} bytes`,
    };
  }

  return { valid: true };
}

function getIp(request) {
  const forwardedFor = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for");
  return forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown";
}

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

export class ClippyCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.config = {
      sessionTtlMs: readNumber(env, "SESSION_TTL_MS", DEFAULTS.sessionTtlMs),
      deviceDisconnectTtlMs: readNumber(env, "DEVICE_DISCONNECT_TTL_MS", DEFAULTS.deviceDisconnectTtlMs),
      maxMessageSize: readNumber(env, "MAX_MESSAGE_SIZE", DEFAULTS.maxMessageSize),
      imageMaxBytes: readNumber(env, "IMAGE_MAX_BYTES", DEFAULTS.imageMaxBytes),
      videoMaxBytes: readNumber(env, "VIDEO_MAX_BYTES", DEFAULTS.videoMaxBytes),
      rateLimitMax: readNumber(env, "RATE_LIMIT_MAX", DEFAULTS.rateLimitMax),
      rateLimitWindowMs: readNumber(env, "RATE_LIMIT_WINDOW_MS", DEFAULTS.rateLimitWindowMs),
      rateLimitBytes: readNumber(env, "RATE_LIMIT_BYTES", DEFAULTS.rateLimitBytes),
      maxDevices: readNumber(env, "MAX_DEVICES", DEFAULTS.maxDevices),
    };
    // Sockets themselves live in the runtime (ctx.getWebSockets), not here, so
    // that the Durable Object can hibernate. Only the rate-limit buckets are
    // kept in memory: they are safe to lose on hibernation because hibernation
    // requires the connection to be idle, and idle time is exactly when a token
    // bucket refills anyway.
    this.runtime = {
      rateLimits: new Map(),
      // In-flight transfers. Deliberately NOT in stateData: stateData is what
      // gets written to ctx.storage, and persisting transfer bookkeeping would
      // break the zero-storage guarantee (RNF-08).
      transfers: new Map(),
    };
    this.stateData = createState();

    // Answer client keepalives in the runtime itself: this keeps mobile
    // networks and proxies from dropping idle connections without waking the
    // object, so it costs no duration and does not block hibernation.
    if (typeof WebSocketRequestResponsePair === "function" && this.ctx.setWebSocketAutoResponse) {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }

    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const persisted = await this.ctx.storage.get("state");
      this.stateData = persisted || createState();
      await this.cleanupExpiredSessions({ persist: false });
      await this.scheduleNextAlarm();
    });
  }

  async fetch(request) {
    await this.ready;

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return this.handleHealth();
    }

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected websocket upgrade.", { status: 426 });
    }

    return this.handleWebSocket(request);
  }

  async alarm() {
    await this.ready;
    await this.cleanupExpiredSessions({ persist: true });
    await this.scheduleNextAlarm();
  }

  async handleHealth() {
    const sessions = Object.values(this.stateData.sessionsByCode);
    const totalDevices = sessions.reduce(
      (count, session) => count + session.devices.filter((device) => device.status === "connected").length,
      0
    );

    return json({
      status: "ok",
      runtime: "cloudflare-durable-object",
      activeSessions: sessions.length,
      activeConnections: this.ctx.getWebSockets().length,
      totalDevices,
    });
  }

  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const socketId = generateId();
    const ip = getIp(request);
    // The code this object was addressed with. Every socket that reaches this
    // object carries the same one, because routing is keyed on it.
    const doCode = String(new URL(request.url).searchParams.get("code") || "").toUpperCase();

    // Hibernation API: the runtime holds the connection open while this object
    // is evicted from memory, so idle sessions stop accruing duration charges.
    // The socketId is used as a tag so it can be looked up again after a wake.
    this.ctx.acceptWebSocket(server, [socketId]);
    server.serializeAttachment({ socketId, ip, code: null, doCode });

    this.sendSocket(server, {
      type: "connected",
      socketId,
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // ── Hibernation lifecycle handlers ────────────────────────────────────────
  // These replace the addEventListener callbacks: the runtime calls them after
  // waking the object, which is what allows it to sleep in between.

  async webSocketMessage(ws, message) {
    await this.ready;

    const attachment = this.attachmentOf(ws);
    if (!attachment) {
      return;
    }

    try {
      await this.handleSocketMessage(attachment.socketId, message);
    } catch (error) {
      console.error("[Clippy DO] Message error:", error);
      this.sendById(attachment.socketId, { type: "error", message: "Unexpected server error" });
    }
  }

  async webSocketClose(ws) {
    await this.ready;
    await this.handleSocketGone(ws);
  }

  async webSocketError(ws) {
    await this.ready;
    await this.handleSocketGone(ws);
  }

  async handleSocketGone(ws) {
    const attachment = this.attachmentOf(ws);
    if (!attachment) {
      return;
    }

    try {
      // Read the code straight off the closing socket rather than looking it up:
      // by the time this fires the socket may already be gone from getWebSockets.
      await this.handleDisconnect(attachment.socketId, attachment.code || null);
    } catch (error) {
      console.error("[Clippy DO] Disconnect error:", error);
    }
  }

  // ── Socket lookup helpers (replace the old in-memory maps) ────────────────

  attachmentOf(ws) {
    try {
      return ws.deserializeAttachment();
    } catch {
      return null;
    }
  }

  socketById(socketId) {
    if (!socketId) {
      return null;
    }
    const matches = this.ctx.getWebSockets(socketId);
    return matches && matches.length ? matches[0] : null;
  }

  /** Session code this socket belongs to, or null if it has not joined one. */
  codeOfSocket(socketId) {
    const socket = this.socketById(socketId);
    if (!socket) {
      return null;
    }
    const attachment = this.attachmentOf(socket);
    return attachment ? attachment.code || null : null;
  }

  /** Bind (or unbind, with null) a socket to a session code. */
  setSocketCode(socketId, code) {
    const socket = this.socketById(socketId);
    if (!socket) {
      return;
    }
    const attachment = this.attachmentOf(socket) || { socketId, ip: "unknown" };
    attachment.code = code;
    try {
      socket.serializeAttachment(attachment);
    } catch (error) {
      console.error("[Clippy DO] Attachment error:", error);
    }
  }

  /** The session code this object owns, taken from the connection URL. */
  doCodeOfSocket(socketId) {
    const socket = this.socketById(socketId);
    if (!socket) {
      return "";
    }
    const attachment = this.attachmentOf(socket);
    return (attachment && attachment.doCode) || "";
  }

  ipOfSocket(socketId) {
    const socket = this.socketById(socketId);
    if (!socket) {
      return "unknown";
    }
    const attachment = this.attachmentOf(socket);
    return (attachment && attachment.ip) || "unknown";
  }

  async handleSocketMessage(socketId, raw) {
    const isBinary = typeof raw !== "string";
    const byteCost = isBinary ? raw.byteLength || 0 : new TextEncoder().encode(raw).length;

    const ip = this.ipOfSocket(socketId);

    // The byte lane always applies: it is what actually bounds throughput.
    if (!this.checkRateLimit(ip, { msgCost: 0, byteCost })) {
      this.sendById(socketId, { type: "error", message: "Rate limit exceeded. Please slow down." });
      return;
    }

    if (isBinary) {
      this.handleTransferChunk(socketId, raw);
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      this.sendById(socketId, { type: "error", message: "Invalid message format" });
      return;
    }

    // The message lane guards the control plane against floods. Transfer
    // flow-control is exempt: one ack per chunk is inherent to the protocol and
    // its count is already bounded by the byte lane, so charging it here would
    // stall any transfer longer than the message allowance.
    if (!TRANSFER_FLOW_TYPES.has(data.type) && !this.checkRateLimit(ip, { msgCost: 1 })) {
      this.sendById(socketId, { type: "error", message: "Rate limit exceeded. Please slow down." });
      return;
    }

    switch (data.type) {
      case "create_session":
        await this.handleCreateSession(socketId);
        break;
      case "join_session":
        await this.handleJoinSession(socketId, data);
        break;
      case "resume_session":
        await this.handleResumeSession(socketId, data);
        break;
      case "send_clip":
        await this.handleSendClip(socketId, data);
        break;
      case "send_image":
        await this.handleSendImage(socketId, data);
        break;
      case "transfer_start":
        this.handleTransferStart(socketId, data);
        break;
      case "transfer_ready":
      case "transfer_ack":
        this.relayToTransferSender(socketId, data);
        break;
      case "transfer_end":
        this.handleTransferEnd(socketId, data);
        break;
      case "transfer_abort":
        this.handleTransferAbort(socketId, data);
        break;
      case "leave_session":
        await this.handleLeaveSession(socketId);
        break;
      default:
        this.sendById(socketId, { type: "error", message: `Unknown event type: ${data.type}` });
    }
  }

  async handleCreateSession(socketId) {
    if (this.codeOfSocket(socketId)) {
      this.sendById(socketId, { type: "error", message: "You are already in a session" });
      return;
    }

    // The code is chosen by the client and encoded in the connection URL, which
    // is what routes it to this object. Generating one here would be pointless:
    // it would belong to a different object than the one the client reached.
    const code = this.doCodeOfSocket(socketId);
    if (!validateCode(code)) {
      this.sendById(socketId, { type: "error", message: "Connection is missing a valid session code" });
      return;
    }

    if (this.stateData.sessionsByCode[code]) {
      // Collision: the client picks another code and reconnects.
      this.sendById(socketId, { type: "code_taken", code });
      return;
    }

    const sessionId = generateId();
    const deviceId = generateId();
    const resumeToken = generateResumeToken();
    const now = Date.now();

    this.stateData.sessionsByCode[code] = {
      sessionId,
      code,
      createdAt: now,
      expiresAt: now + this.config.sessionTtlMs,
      state: "active",
      devices: [
        {
          deviceId,
          socketId,
          status: "connected",
          resumeToken,
          lastSeen: now,
        },
      ],
    };
    this.stateData.sessionIds[sessionId] = code;
    this.stateData.deviceToSession[deviceId] = code;
    this.setSocketCode(socketId, code);

    await this.persistState();
    await this.scheduleNextAlarm();

    this.sendById(socketId, {
      type: "session_created",
      code,
      sessionId,
      deviceId,
      resumeToken,
    });
  }

  async handleJoinSession(socketId, data) {
    const code = String(data.code || "").toUpperCase();
    if (!validateCode(code)) {
      this.sendById(socketId, { type: "error", message: "Invalid code format. Use format: ABC-12K" });
      return;
    }

    // Sessions are sharded by code, so a request for a different code than the
    // one that routed here can only be a client bug or a probe.
    if (code !== this.doCodeOfSocket(socketId)) {
      this.sendById(socketId, { type: "error", message: "Session not found or expired" });
      return;
    }

    const session = this.stateData.sessionsByCode[code];
    if (!session) {
      this.sendById(socketId, { type: "error", message: "Session not found or expired" });
      return;
    }

    if (Date.now() > session.expiresAt) {
      await this.expireSession(code, "Session expired");
      await this.persistState();
      await this.scheduleNextAlarm();
      this.sendById(socketId, { type: "error", message: "Session has expired" });
      return;
    }

    const connectedDevices = session.devices.filter((device) => device.status === "connected").length;
    if (connectedDevices >= this.config.maxDevices) {
      this.sendById(socketId, {
        type: "error",
        message: `Session is full (max ${this.config.maxDevices} devices)`,
      });
      return;
    }

    const deviceId = generateId();
    const resumeToken = generateResumeToken();
    const now = Date.now();

    session.devices.push({
      deviceId,
      socketId,
      status: "connected",
      resumeToken,
      lastSeen: now,
    });
    session.expiresAt = now + this.config.sessionTtlMs;
    this.stateData.deviceToSession[deviceId] = code;
    this.setSocketCode(socketId, code);

    await this.persistState();
    await this.scheduleNextAlarm();

    this.sendById(socketId, {
      type: "session_joined",
      code,
      sessionId: session.sessionId,
      deviceId,
      resumeToken,
      devices: session.devices.filter((device) => device.status === "connected").length,
      role: "guest",
    });

    this.broadcastToPeers(code, socketId, {
      type: "device_connected",
      code,
      devices: session.devices.filter((device) => device.status === "connected").length,
    });
  }

  async handleResumeSession(socketId, data) {
    const { sessionId, deviceId, resumeToken } = data;
    if (!sessionId || !deviceId || !resumeToken) {
      this.sendById(socketId, { type: "error", message: "Missing resume credentials" });
      return;
    }

    const code = this.stateData.sessionIds[sessionId];
    if (!code) {
      this.sendById(socketId, { type: "error", message: "Session not found" });
      return;
    }

    const session = this.stateData.sessionsByCode[code];
    if (!session) {
      this.sendById(socketId, { type: "error", message: "Session not found" });
      return;
    }

    if (Date.now() > session.expiresAt) {
      await this.expireSession(code, "Session expired");
      await this.persistState();
      await this.scheduleNextAlarm();
      this.sendById(socketId, { type: "error", message: "Session has expired" });
      return;
    }

    const device = session.devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) {
      this.sendById(socketId, { type: "error", message: "Device not found in session" });
      return;
    }

    if (device.resumeToken !== resumeToken) {
      this.sendById(socketId, { type: "error", message: "Invalid resume token" });
      return;
    }

    if (device.socketId && device.socketId !== socketId) {
      this.closeSocket(device.socketId, 1001, "Superseded by a resumed connection");
    }

    device.socketId = socketId;
    device.status = "connected";
    device.lastSeen = Date.now();
    session.expiresAt = Date.now() + this.config.sessionTtlMs;
    this.setSocketCode(socketId, code);

    await this.persistState();
    await this.scheduleNextAlarm();

    const deviceCount = session.devices.filter((candidate) => candidate.status === "connected").length;

    this.sendById(socketId, {
      type: "session_resumed",
      code,
      sessionId,
      deviceId,
      devices: deviceCount,
    });

    this.broadcastToPeers(code, socketId, {
      type: "device_connected",
      code,
      devices: deviceCount,
    });
  }

  async handleSendClip(socketId, data) {
    const validation = validateMessage(data.content, this.config.maxMessageSize);
    if (!validation.valid) {
      this.sendById(socketId, { type: "error", message: validation.error });
      return;
    }

    const code = this.codeOfSocket(socketId);
    if (!code) {
      this.sendById(socketId, { type: "error", message: "Not in a session" });
      return;
    }

    const session = this.stateData.sessionsByCode[code];
    if (!session) {
      this.sendById(socketId, { type: "error", message: "Session not found or expired" });
      return;
    }

    const peers = this.getPeerSocketIds(code, socketId);
    if (peers.length === 0) {
      this.sendById(socketId, { type: "error", message: "No connected peers" });
      return;
    }

    const payload = {
      type: "receive_clip",
      content: sanitizeText(data.content),
      timestamp: Date.now(),
    };

    for (const peerSocketId of peers) {
      this.sendById(peerSocketId, payload);
    }

    this.sendById(socketId, {
      type: "clip_sent",
      timestamp: payload.timestamp,
    });
  }

  async handleSendImage(socketId, data) {
    const validation = validateImage(data.data, this.config.imageMaxBytes);
    if (!validation.valid) {
      this.sendById(socketId, { type: "error", message: validation.error });
      return;
    }

    const code = this.codeOfSocket(socketId);
    if (!code) {
      this.sendById(socketId, { type: "error", message: "Not in a session" });
      return;
    }

    const peers = this.getPeerSocketIds(code, socketId);
    if (peers.length === 0) {
      this.sendById(socketId, { type: "error", message: "No connected peers" });
      return;
    }

    const timestamp = Date.now();

    for (const peerSocketId of peers) {
      this.sendById(peerSocketId, {
        type: "receive_image",
        data: data.data,
        mimeType: validation.mimeType,
        timestamp,
      });
    }

    this.sendById(socketId, { type: "image_sent", timestamp });
  }

  // ── Chunked transfers (RF-15) ─────────────────────────────────────────────
  // Payload bytes are relayed verbatim and never stored, buffered or parsed.
  // Only the small header is read, to attribute a chunk to a transfer.

  handleTransferStart(socketId, data) {
    const code = this.codeOfSocket(socketId);
    if (!code) {
      this.sendById(socketId, { type: "error", message: "Not in a session" });
      return;
    }

    const transferId = String(data.transferId || "");
    if (!/^[a-f0-9]{32}$/.test(transferId)) {
      this.sendById(socketId, { type: "error", message: "Invalid transfer id" });
      return;
    }

    const mimeType = String(data.mimeType || "");
    if (!ALLOWED_VIDEO_TYPES.has(mimeType)) {
      this.sendById(socketId, {
        type: "transfer_aborted",
        transferId,
        reason: "Unsupported format. Use MP4, WEBM or MOV.",
      });
      return;
    }

    const size = Number(data.size);
    const chunkSize = Number(data.chunkSize);
    const chunkCount = Number(data.chunkCount);

    if (!Number.isFinite(size) || size <= 0 || size > this.config.videoMaxBytes) {
      this.sendById(socketId, {
        type: "transfer_aborted",
        transferId,
        reason: `Video exceeds ${Math.floor(this.config.videoMaxBytes / (1024 * 1024))} MB limit`,
      });
      return;
    }

    if (
      !Number.isFinite(chunkSize) || chunkSize <= 0 || chunkSize > MAX_CHUNK_BYTES ||
      !Number.isFinite(chunkCount) || chunkCount !== Math.ceil(size / chunkSize)
    ) {
      this.sendById(socketId, { type: "error", message: "Invalid transfer framing" });
      return;
    }

    // One transfer per sender at a time keeps memory and bookkeeping bounded.
    for (const [id, transfer] of this.runtime.transfers) {
      if (transfer.socketId === socketId) {
        this.runtime.transfers.delete(id);
      }
    }

    const peers = this.getPeerSocketIds(code, socketId);
    if (peers.length === 0) {
      this.sendById(socketId, {
        type: "transfer_aborted",
        transferId,
        reason: "No connected peers",
      });
      return;
    }

    this.runtime.transfers.set(transferId, {
      socketId,
      code,
      size,
      chunkSize,
      chunkCount,
      bytesSeen: 0,
    });

    for (const peerSocketId of peers) {
      this.sendById(peerSocketId, {
        type: "transfer_incoming",
        transferId,
        name: typeof data.name === "string" ? sanitizeText(data.name).slice(0, 200) : "video",
        mimeType,
        size,
        chunkSize,
        chunkCount,
      });
    }
  }

  handleTransferChunk(socketId, raw) {
    const bytes = new Uint8Array(raw);
    if (bytes.byteLength <= TRANSFER_HEADER_BYTES || bytes[0] !== TRANSFER_FRAME_VERSION) {
      return;
    }

    const transferId = hexFromBytes(bytes.subarray(1, 1 + TRANSFER_ID_BYTES));
    const transfer = this.runtime.transfers.get(transferId);

    // Unknown transfer, or a socket relaying someone else's id.
    if (!transfer || transfer.socketId !== socketId) {
      return;
    }

    const payloadBytes = bytes.byteLength - TRANSFER_HEADER_BYTES;
    transfer.bytesSeen += payloadBytes;

    if (transfer.bytesSeen > transfer.size) {
      this.runtime.transfers.delete(transferId);
      this.abortTransfer(transferId, transfer, "Transfer exceeded declared size");
      return;
    }

    for (const peerSocketId of this.getPeerSocketIds(transfer.code, socketId)) {
      this.sendRawById(peerSocketId, raw);
    }
  }

  handleTransferEnd(socketId, data) {
    const transferId = String(data.transferId || "");
    const transfer = this.runtime.transfers.get(transferId);
    if (!transfer || transfer.socketId !== socketId) {
      return;
    }

    this.runtime.transfers.delete(transferId);

    const complete = transfer.bytesSeen === transfer.size;
    const payload = complete
      ? { type: "transfer_complete", transferId }
      : { type: "transfer_aborted", transferId, reason: "Transfer ended early" };

    for (const peerSocketId of this.getPeerSocketIds(transfer.code, socketId)) {
      this.sendById(peerSocketId, payload);
    }
    // The sender needs the same verdict to clear its progress UI.
    this.sendById(socketId, payload);
  }

  handleTransferAbort(socketId, data) {
    const transferId = String(data.transferId || "");
    const transfer = this.runtime.transfers.get(transferId);
    if (!transfer) {
      return;
    }

    // Either end may abort: the sender gives up, or the receiver rejects it.
    const code = this.codeOfSocket(socketId);
    if (transfer.socketId !== socketId && transfer.code !== code) {
      return;
    }

    this.runtime.transfers.delete(transferId);
    this.abortTransfer(transferId, transfer, String(data.reason || "Transfer cancelled"), socketId);
  }

  abortTransfer(transferId, transfer, reason, excludeSocketId) {
    const payload = { type: "transfer_aborted", transferId, reason };

    for (const peerSocketId of this.getPeerSocketIds(transfer.code, excludeSocketId)) {
      this.sendById(peerSocketId, payload);
    }
    if (excludeSocketId !== transfer.socketId) {
      this.sendById(transfer.socketId, payload);
    }
  }

  /** Route receiver-side control messages (ready/ack) back to the sender. */
  relayToTransferSender(socketId, data) {
    const transfer = this.runtime.transfers.get(String(data.transferId || ""));
    if (!transfer) {
      return;
    }
    if (transfer.code !== this.codeOfSocket(socketId)) {
      return;
    }
    this.sendById(transfer.socketId, data);
  }

  /** Drop any transfers owned by a socket that went away. */
  cancelTransfersFor(socketId) {
    for (const [transferId, transfer] of this.runtime.transfers) {
      if (transfer.socketId === socketId) {
        this.runtime.transfers.delete(transferId);
        this.abortTransfer(transferId, transfer, "Sender disconnected", socketId);
      }
    }
  }

  async handleLeaveSession(socketId) {
    const code = this.codeOfSocket(socketId);
    this.setSocketCode(socketId, null);

    if (!code) {
      this.sendById(socketId, { type: "session_left" });
      return;
    }

    const session = this.stateData.sessionsByCode[code];
    if (!session) {
      this.sendById(socketId, { type: "session_left" });
      return;
    }

    const deviceIndex = session.devices.findIndex((device) => device.socketId === socketId);
    if (deviceIndex !== -1) {
      const [device] = session.devices.splice(deviceIndex, 1);
      delete this.stateData.deviceToSession[device.deviceId];
    }

    if (session.devices.length === 0) {
      delete this.stateData.sessionIds[session.sessionId];
      delete this.stateData.sessionsByCode[code];
    }

    await this.persistState();
    await this.scheduleNextAlarm();

    const remainingDevices = session.devices.filter((device) => device.status === "connected").length;
    this.broadcastToPeers(code, socketId, {
      type: "device_disconnected",
      devices: remainingDevices,
    });

    this.sendById(socketId, { type: "session_left" });
  }

  async handleDisconnect(socketId, code) {
    // Rate-limit buckets are keyed by IP and deliberately outlive the socket:
    // clearing them here would let a client reset its budget by reconnecting.
    this.cancelTransfersFor(socketId);

    if (!code) {
      return;
    }

    const session = this.stateData.sessionsByCode[code];
    if (!session) {
      return;
    }

    const device = session.devices.find((candidate) => candidate.socketId === socketId);
    if (!device) {
      return;
    }

    device.status = "temporarily_disconnected";
    device.lastSeen = Date.now();

    await this.persistState();
    await this.scheduleNextAlarm();

    this.broadcastToPeers(code, socketId, {
      type: "device_disconnected",
      devices: session.devices.filter((candidate) => candidate.status === "connected").length,
    });
  }

  /**
   * Two-lane token bucket, keyed by IP.
   *
   * The message lane preserves the previous behaviour (rateLimitMax per window)
   * and guards against control-message spam. The byte lane bounds throughput
   * independently, so a large binary transfer is limited by how many bytes it
   * moves rather than by how many frames it is split into — a message counter
   * alone would reject a chunked transfer after the first few chunks.
   *
   * Buckets live in memory only. Losing them to hibernation is safe because
   * hibernation requires the connection to have been idle, and idle time is
   * exactly when the bucket refills.
   */
  checkRateLimit(ip, { msgCost = 1, byteCost = 0 } = {}) {
    const now = Date.now();
    const windowMs = this.config.rateLimitWindowMs;
    const maxMsg = this.config.rateLimitMax;
    const maxBytes = this.config.rateLimitBytes;

    let bucket = this.runtime.rateLimits.get(ip);
    if (!bucket) {
      bucket = { msgTokens: maxMsg, byteTokens: maxBytes, lastRefill: now };
      this.runtime.rateLimits.set(ip, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      const refilled = elapsed / windowMs;
      bucket.msgTokens = Math.min(maxMsg, bucket.msgTokens + refilled * maxMsg);
      bucket.byteTokens = Math.min(maxBytes, bucket.byteTokens + refilled * maxBytes);
      bucket.lastRefill = now;
    }

    if (bucket.msgTokens < msgCost || bucket.byteTokens < byteCost) {
      return false;
    }

    bucket.msgTokens -= msgCost;
    bucket.byteTokens -= byteCost;

    // Drop fully-refilled buckets so idle origins do not accumulate.
    if (bucket.msgTokens >= maxMsg && bucket.byteTokens >= maxBytes) {
      this.runtime.rateLimits.delete(ip);
    }

    return true;
  }

  async cleanupExpiredSessions({ persist }) {
    const now = Date.now();
    let changed = false;

    for (const [code, session] of Object.entries(this.stateData.sessionsByCode)) {
      if (now > session.expiresAt) {
        await this.expireSession(code, "Session expired");
        changed = true;
        continue;
      }

      const filteredDevices = [];
      for (const device of session.devices) {
        const isStale =
          device.status === "temporarily_disconnected" &&
          now - device.lastSeen > this.config.deviceDisconnectTtlMs;

        if (isStale) {
          delete this.stateData.deviceToSession[device.deviceId];
          changed = true;
          continue;
        }

        filteredDevices.push(device);
      }

      if (filteredDevices.length !== session.devices.length) {
        session.devices = filteredDevices;
        changed = true;
      }

      if (session.devices.length === 0) {
        delete this.stateData.sessionIds[session.sessionId];
        delete this.stateData.sessionsByCode[code];
        changed = true;
      }
    }

    if (persist && changed) {
      await this.persistState();
    }
  }

  async expireSession(code, closeReason) {
    const session = this.stateData.sessionsByCode[code];
    if (!session) {
      return;
    }

    for (const device of session.devices) {
      delete this.stateData.deviceToSession[device.deviceId];
      if (device.socketId) {
        this.setSocketCode(device.socketId, null);
        this.sendById(device.socketId, { type: "session_expired" });
        this.closeSocket(device.socketId, 1000, closeReason);
      }
    }

    delete this.stateData.sessionIds[session.sessionId];
    delete this.stateData.sessionsByCode[code];
  }

  async persistState() {
    await this.ctx.storage.put("state", this.stateData);
  }

  async scheduleNextAlarm() {
    const sessions = Object.values(this.stateData.sessionsByCode);
    if (sessions.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const now = Date.now();
    let nextAlarm = now + 30000;

    for (const session of sessions) {
      nextAlarm = Math.min(nextAlarm, session.expiresAt);

      for (const device of session.devices) {
        if (device.status === "temporarily_disconnected") {
          nextAlarm = Math.min(nextAlarm, device.lastSeen + this.config.deviceDisconnectTtlMs);
        }
      }
    }

    await this.ctx.storage.setAlarm(Math.max(now + 1000, nextAlarm));
  }

  getPeerSocketIds(code, excludeSocketId) {
    const session = this.stateData.sessionsByCode[code];
    if (!session) {
      return [];
    }

    return session.devices
      .filter((device) => device.socketId !== excludeSocketId && device.status === "connected")
      .map((device) => device.socketId)
      .filter((candidateSocketId) => this.socketById(candidateSocketId) !== null);
  }

  broadcastToPeers(code, excludeSocketId, payload) {
    for (const socketId of this.getPeerSocketIds(code, excludeSocketId)) {
      this.sendById(socketId, payload);
    }
  }

  sendById(socketId, payload) {
    const socket = this.socketById(socketId);
    if (!socket) {
      return;
    }

    this.sendSocket(socket, payload);
  }

  sendSocket(socket, payload) {
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.error("[Clippy DO] Send error:", error);
    }
  }

  /** Forward a binary frame untouched — no copy, no parse, no buffering. */
  sendRawById(socketId, buffer) {
    const socket = this.socketById(socketId);
    if (!socket) {
      return;
    }
    try {
      socket.send(buffer);
    } catch (error) {
      console.error("[Clippy DO] Raw send error:", error);
    }
  }

  closeSocket(socketId, code, reason) {
    const socket = this.socketById(socketId);

    if (!socket) {
      return;
    }

    try {
      socket.close(code, reason);
    } catch (error) {
      console.error("[Clippy DO] Close error:", error);
    }
  }
}

/**
 * Route each session to its own Durable Object, keyed by the pairing code.
 *
 * A single shared coordinator would put every user's traffic through one
 * object, which caps the whole service at that object's request throughput.
 * Sharding by code means concurrent sessions no longer contend with each other.
 */
export function coordinatorNameFor(request) {
  const code = String(new URL(request.url).searchParams.get("code") || "").toUpperCase();
  return validateCode(code) ? code : "lobby";
}

export default {
  async fetch(request, env) {
    const id = env.CLIPPY_COORDINATOR.idFromName(coordinatorNameFor(request));
    const stub = env.CLIPPY_COORDINATOR.get(id);
    return stub.fetch(request);
  },
};
