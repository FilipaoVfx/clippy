# Pastty (Clippy)

**Real-time clipboard sync between devices via ephemeral pairing codes.**
Cloudflare deployment: **one Worker with Static Assets and Durable Objects**.
Live: **[Pastty](https://clippy-realtime.juanku2003.workers.dev/)**.

The Pastty identity follows the supplied Drive concept: ivory, black type, yellow
pasta connections and 3D devices. Home, pairing, sharing and the PWA use the same
system, with self-hosted fonts and offline assets. See [DESIGN.md](DESIGN.md) and
[PRODUCT.md](PRODUCT.md). The technical Worker and protocol names remain Clippy.

No account, no install, no persistence: two devices join a session with a short code,
and whatever you copy on one shows up on the other over a persistent WebSocket channel.
When the session expires, everything is gone.

---

## Problem

Switching devices breaks the flow. AirDrop is platform-locked, mail-to-self is noise,
and notes apps turn a two-second action into a five-step ritual. All of them are friction
disguised as a solution.

## Solution

An ephemeral session identified by a pairing code (also shareable as a QR), a WebSocket
channel per session, and a hard TTL. The clipboard becomes transparent: copy here, paste there.

---

## Architecture

```text
        Device A                          Device B
           │                                 │
           │  WebSocket /ws                  │
           └───────────────┬─────────────────┘
                           ▼
              ┌────────────────────────┐
              │  Session layer         │
              │                        │
              │  Node: express + ws    │   ← self-hosted / local dev
              │  or                    │
              │  Cloudflare Durable     │   ← edge deployment
              │  Object (Coordinator)  │
              └───────────┬────────────┘
                          │
             ┌────────────┴────────────┐
             │  In-memory session map  │
             │  code → devices         │
             │  TTL + periodic cleanup │
             └─────────────────────────┘

     Static PWA (public/) → Worker Static Assets
```

Two interchangeable implementations of the same protocol:

| Runtime | Entry point | State |
|---|---|---|
| Node | `server/index.js` (express + `ws`) | `Map` in process, cleaned every 30s |
| Cloudflare | `cloudflare/realtime/src/index.js` | Durable Object `ClippyCoordinator` |

The frontend (`public/`) is a dependency-free PWA — vanilla JS modules (`app`, `ui`, `ws`, `qr`),
a service worker and a web manifest — so it can be served by either runtime unchanged.

---

## Features

- Pairing by short code, with QR for phone-to-desktop
- Real-time text and image sync over WebSocket
- Up to 5 devices per session
- Resume token: a dropped device can rejoin its session instead of starting over
- Session TTL with automatic cleanup; devices are evicted after a disconnect grace period
- `GET /health` exposing uptime and live session stats
- Installable PWA with an offline app shell
- In-tree QR encoder (byte mode, EC level M) — no CDN, works offline

---

## Tech stack

| Technology | Why |
|---|---|
| Node + Express | Static hosting and health endpoint in one small process |
| `ws` | Raw WebSocket server — no abstraction layer over a protocol this simple |
| Cloudflare Durable Objects | Single-threaded coordination point per session, at the edge |
| Workers Static Assets | Static PWA and WebSockets on the same origin |
| Vanilla JS (no framework) | The whole UI is one screen; a framework would be dead weight |
| Vitest | Fast unit tests for session, validation, QR and transport logic |

---

## Technical decisions

**Ephemeral by default.** No database, no user accounts, no message history. Sessions live in
memory and die on TTL. Less stored data is less to secure, less to leak, and less to explain.

**WebSocket over polling.** Polling breaks the illusion of continuity and wastes requests when
idle. A persistent socket with reconnect keeps latency under the perception threshold.

**A Durable Object per session.** Sessions need a single authoritative coordinator. Durable
Objects give exactly that at the edge, without deploying and babysitting a stateful server.

**Deploys must not break installed PWAs.** The service worker precaches the app shell and
`skipWaiting()`s on install; navigations are network-first (fresh HTML after a deploy, cache
when offline) and static assets stale-while-revalidate. `BUILD_ID` is replaced with a hash of the app shell
at build time, so a new version swaps in transparently and the home-screen icon stays put.

**Validation at the edge of the process.** Every inbound message goes through size checks,
type checks and rate limiting before the handler ever sees it (`server/security.js`).

---

## Trade-offs

- **In-memory state** → a Node restart drops active sessions. Acceptable: sessions are
  short-lived by design, and clients can re-pair in seconds.
- **No end-to-end encryption (yet)** → content is protected in transit by TLS, but the
  session layer can read it. E2E is the next meaningful step, not a claim to make today.
- **Two runtimes** → the protocol has to stay in sync in two places. The tests cover both
  to keep them honest.

---

## Security

- Sliding-window rate limit per IP (default: 30 messages / 60s)
- Message size cap (default 10 KB text) and image size cap (default 5 MB)
- Image type allowlist: `image/png`, `image/jpeg`, `image/webp`
- Text sanitisation and pairing-code validation before routing
- Device cap per session (5) to bound fan-out
- Secrets and limits via environment variables — see `.env.example`

---

## Testing

```bash
npm test              # vitest run
npm run test:coverage
```

Covers session lifecycle (`tests/server/sessionManager.test.js`), image validation,
QR generation, client transport, and the Durable Object coordinator against a
Cloudflare Workers mock (`tests/__mocks__/cloudflare-workers.js`).

---

## Deployment

Deploy as a **Cloudflare Worker**, named `clippy-realtime`. Its single deployment serves
static assets, `/health`, `/ws`, and the `ClippyCoordinator` Durable Object.
The existing SQLite migration and Worker name are retained.

```bash
npm ci
npm test
npm run cf:check             # build + validate locally, no deployment
npm run deploy              # build + publish Worker and assets
npm run cf:dev              # full Cloudflare runtime locally
```

GitHub Actions (`.github/workflows/deploy-cloudflare.yml`) tests and validates PRs;
pushes to `main` also deploy using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
Alternatively connect GitHub through Cloudflare Workers Builds; enable only one deployment pipeline.

See [`cloudflare/DEPLOY.md`](cloudflare/DEPLOY.md) for exact dashboard settings,
credentials, migration from Pages, and verification.

---

## Local development

```bash
npm install
cp .env.example .env
npm run dev        # node --watch server/index.js → http://localhost:3000
```

Configurable via env: `PORT`, `SESSION_TTL_MS`, `MAX_MESSAGE_SIZE`, `IMAGE_MAX_BYTES`,
`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`.

---

## Roadmap

- End-to-end encryption of payloads before they reach the session layer
- File transfer beyond images
- Session history opt-in (explicitly off by default today)

---

## License

MIT — see [`package.json`](package.json).
