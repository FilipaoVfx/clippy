const assert = require('node:assert/strict');
const WebSocket = require('ws');

async function verify(origin) {
  const base = new URL(origin);
  assert.ok(['http:', 'https:'].includes(base.protocol), 'Expected an HTTP(S) origin');
  const health = await fetch(new URL('/health', base), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(health.status, 200, '/health must return 200');
  assert.match(health.headers.get('content-type') || '', /application\/json/i,
    '/health returned the frontend instead of JSON: the domain is not routed to the Worker');
  const data = await health.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.runtime, 'cloudflare-durable-object');

  const plain = await fetch(new URL('/ws', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(plain.status, 426, '/ws must require a WebSocket upgrade, never return the frontend');

  const socketUrl = new URL('/ws?code=CHK-00A', base);
  socketUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  await new Promise((resolve, reject) => {
    // A protocol keepalive proves the upgrade and DO binding work without
    // creating a room, joining an existing room, or transferring user content.
    const socket = new WebSocket(socketUrl, { handshakeTimeout: 15000 });
    const timer = setTimeout(() => finish(new Error('WebSocket keepalive timed out')), 15000);
    function finish(error) {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on('error', () => {});
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Deployment check complete');
      else socket.terminate();
      if (error) reject(error);
      else resolve();
    }
    socket.on('open', () => socket.send('ping'));
    socket.on('message', (message) => {
      if (message.toString() === 'pong') finish();
    });
    socket.on('error', finish);
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(new Error(`WebSocket upgrade returned HTTP ${response.statusCode}`));
    });
    socket.on('close', () => finish(new Error('WebSocket closed before keepalive reply')));
  });
  console.log(`PASS ${base.origin}: JSON health, HTTP 426 and WebSocket 101/ping/pong`);
}

verify(process.argv[2] || 'https://pastty.com').catch((error) => {
  console.error(`Cloudflare deployment verification failed: ${error.message}`);
  process.exitCode = 1;
});
