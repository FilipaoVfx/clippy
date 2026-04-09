require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { handleConnection } = require('./wsHandler');
const { cleanExpiredSessions, getStats } = require('./sessionManager');
const { cleanRateLimits } = require('./security');

const PORT = parseInt(process.env.PORT || '3000', 10);

// Express app — serves the frontend
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  const stats = getStats();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    ...stats,
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  handleConnection(ws, req);
});

// Periodic cleanup — every 30 seconds
const cleanupInterval = setInterval(() => {
  const cleaned = cleanExpiredSessions();
  cleanRateLimits();
  if (cleaned > 0) {
    console.log(`[Cleanup] Removed ${cleaned} expired sessions`);
  }
}, 30000);

// Graceful shutdown
function shutdown() {
  console.log('\n[Server] Shutting down gracefully...');
  clearInterval(cleanupInterval);

  wss.clients.forEach((ws) => {
    try {
      ws.send(JSON.stringify({ type: 'server_shutdown' }));
      ws.close(1001, 'Server shutting down');
    } catch (e) { /* ignore */ }
  });

  wss.close(() => {
    server.close(() => {
      console.log('[Server] Closed');
      process.exit(0);
    });
  });

  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║                                       ║
  ║   📋 Clippy — Clipboard Sync          ║
  ║                                       ║
  ║   HTTP:  http://localhost:${PORT}        ║
  ║   WS:    ws://localhost:${PORT}/ws       ║
  ║                                       ║
  ╚═══════════════════════════════════════╝
  `);
});
