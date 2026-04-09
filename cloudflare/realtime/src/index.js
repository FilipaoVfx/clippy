import { DurableObject } from "cloudflare:workers";

const DEFAULTS = {
  sessionTtlMs: 300000,
  deviceDisconnectTtlMs: 60000,
  maxMessageSize: 10240,
  rateLimitMax: 30,
  rateLimitWindowMs: 60000,
  maxDevices: 5,
};

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
      rateLimitMax: readNumber(env, "RATE_LIMIT_MAX", DEFAULTS.rateLimitMax),
      rateLimitWindowMs: readNumber(env, "RATE_LIMIT_WINDOW_MS", DEFAULTS.rateLimitWindowMs),
      maxDevices: readNumber(env, "MAX_DEVICES", DEFAULTS.maxDevices),
    };
    this.runtime = {
      sockets: new Map(),
      socketMeta: new Map(),
      socketToSession: new Map(),
      rateLimits: new Map(),
    };
    this.stateData = createState();
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
      activeConnections: this.runtime.socketToSession.size,
      totalDevices,
    });
  }

  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const socketId = generateId();
    const ip = getIp(request);

    server.accept();

    this.runtime.sockets.set(socketId, server);
    this.runtime.socketMeta.set(socketId, { ip });

    server.addEventListener("message", (event) => {
      this.handleSocketMessage(socketId, event.data).catch((error) => {
        console.error("[Clippy DO] Message error:", error);
        this.sendById(socketId, { type: "error", message: "Unexpected server error" });
      });
    });

    const closeHandler = () => {
      this.handleDisconnect(socketId).catch((error) => {
        console.error("[Clippy DO] Disconnect error:", error);
      });
    };

    server.addEventListener("close", closeHandler);
    server.addEventListener("error", closeHandler);

    this.sendSocket(server, {
      type: "connected",
      socketId,
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSocketMessage(socketId, raw) {
    const meta = this.runtime.socketMeta.get(socketId);
    if (!this.checkRateLimit(meta?.ip || "unknown")) {
      this.sendById(socketId, { type: "error", message: "Rate limit exceeded. Please slow down." });
      return;
    }

    let data;
    try {
      data = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      this.sendById(socketId, { type: "error", message: "Invalid message format" });
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
      case "leave_session":
        await this.handleLeaveSession(socketId);
        break;
      default:
        this.sendById(socketId, { type: "error", message: `Unknown event type: ${data.type}` });
    }
  }

  async handleCreateSession(socketId) {
    if (this.runtime.socketToSession.has(socketId)) {
      this.sendById(socketId, { type: "error", message: "You are already in a session" });
      return;
    }

    const code = generateCode(new Set(Object.keys(this.stateData.sessionsByCode)));
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
    this.runtime.socketToSession.set(socketId, code);

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
    this.runtime.socketToSession.set(socketId, code);

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
      this.runtime.socketToSession.delete(device.socketId);
    }

    device.socketId = socketId;
    device.status = "connected";
    device.lastSeen = Date.now();
    session.expiresAt = Date.now() + this.config.sessionTtlMs;
    this.runtime.socketToSession.set(socketId, code);

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

    const code = this.runtime.socketToSession.get(socketId);
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

  async handleLeaveSession(socketId) {
    const code = this.runtime.socketToSession.get(socketId);
    this.runtime.socketToSession.delete(socketId);

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

  async handleDisconnect(socketId) {
    const code = this.runtime.socketToSession.get(socketId);

    this.runtime.sockets.delete(socketId);
    this.runtime.socketMeta.delete(socketId);
    this.runtime.socketToSession.delete(socketId);

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

  checkRateLimit(ip) {
    const now = Date.now();
    const record = this.runtime.rateLimits.get(ip) || [];
    const recent = record.filter((timestamp) => now - timestamp < this.config.rateLimitWindowMs);

    if (recent.length >= this.config.rateLimitMax) {
      this.runtime.rateLimits.set(ip, recent);
      return false;
    }

    recent.push(now);
    this.runtime.rateLimits.set(ip, recent);
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
        this.runtime.socketToSession.delete(device.socketId);
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
      .filter((candidateSocketId) => this.runtime.sockets.has(candidateSocketId));
  }

  broadcastToPeers(code, excludeSocketId, payload) {
    for (const socketId of this.getPeerSocketIds(code, excludeSocketId)) {
      this.sendById(socketId, payload);
    }
  }

  sendById(socketId, payload) {
    const socket = this.runtime.sockets.get(socketId);
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

  closeSocket(socketId, code, reason) {
    const socket = this.runtime.sockets.get(socketId);
    this.runtime.sockets.delete(socketId);
    this.runtime.socketMeta.delete(socketId);

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

export default {
  async fetch(request, env) {
    const id = env.CLIPPY_COORDINATOR.idFromName("global");
    const stub = env.CLIPPY_COORDINATOR.get(id);
    return stub.fetch(request);
  },
};
