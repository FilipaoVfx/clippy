# Visual engine: Three.js + Remotion

Implementation notes for `PASTTY_HYBRID_VISUAL_REQUIREMENTS.md`, adapted to
this repository. The spec says to inspect first and propose the smallest
change; this file is that report plus what was built in each phase.

## Phase 0: audit (what the repo really looks like)

| Spec assumption | Reality in this repo | Decision |
|---|---|---|
| `frontend/src/...` tree, bundler | Plain files in `public/` (`js/*.js` classic scripts, no bundler). `scripts/build.cjs` copies `public/` to `dist/` and hashes the SW shell | Keep it. New code goes in `public/js/bus.js` and `public/js/visual/` as native ES modules |
| Cloudflare Pages | One Worker with static assets (`wrangler.toml [assets]`) plus a Durable Object per room | No change |
| A new Event Bus is needed | `public/js/ws.js` already emits every server message by type (`WS.on('device_connected', …)`) | Add a tiny app-level bus (`PasttyBus`) that `app.js` feeds with **normalized, secret-free** events. The visual layer never sees `WS` |
| Events carry device ids and types | `device_connected` / `device_disconnected` / `session_*` carry only the **connected-device count** | The scene reconciles to the count: one node for this device, `count - 1` generic peer nodes. Your own device type is detected locally; peers render as the spec's "generic device" |
| `SYNC_COMPLETED` on delivery | `clip_sent` / `image_sent` mean "the room relayed it to every peer", not "the peer read it". `transfer_complete` fires once every chunk was acked by the receiver | Text/image: a *sent* pulse. Video: a *completed* pulse on `transfer_complete`. No protocol change |
| Incoming transfers identify the sender | `receive_clip` / `receive_image` / `transfer_incoming` don't say which peer sent it | Inbound particles converge on this device from the room; with two devices (the common case) that is exact |
| Up to five devices | `MAX_DEVICES = 5` (server and Durable Object) | Scene pool is fixed at 5 nodes / 4 links |
| Static fallback composition | `.device-scene` already paints `assets/pastty-devices.webp` | It is the no-WebGL / reduced-motion / context-lost fallback |
| Palette | Current tokens are close (`#f4ece5` paper, `#ffbd20` yellow, `#222122` ink) | Move to the spec's warm palette (ivory, pasta, golden, orange, charcoal). `#A5A09A` fails contrast for text, so it is used only for decoration |
| Remotion | `motion/` workspace already renders WebM, MP4 and WebP posters, with no Remotion runtime on the site | Add the five spec compositions; retone everything to the warm palette |

Open choices taken (the user asked to run all phases without stopping):

1. **Brutalism stays hard-edged** (ink outlines, offset shadows) instead of the
   soft glass of the reference render. The spec asks for "bordes visibles".
2. **Smooth cartoon strands** (toon shading and an ink outline), with no fluted
   or hollow pasta. The spec forbids food-photo texture.
3. **"Sent", not "delivered"**, for text and images, because the protocol has
   no read receipt.

## Phase 1: static identity

- Warm palette as `--color-*` tokens in `public/css/style.css` (ivory, cream,
  pasta, golden, orange, peach, charcoal). Text keeps AA contrast: muted copy
  `#655d57` is 5.8:1 on ivory and `--yellow-ink` `#8f5a00` is 5.2:1.
- The hero keeps *Pastty.* / *Copy. Share. Sync.*, Start/Join session and the
  indicator strip (Real-time · No account · Nothing stored). "Secure" was left
  out: anyone with the code can join, so it would overclaim.
- Static fallback: `.device-scene` (`assets/pastty-devices.webp`).

## Phase 2: Three.js layer

`public/js/visual/three/`, imported from `public/vendor/three.min.js`: a
tree-shaken r186 subset (31 exports, about 143 KB gzip) built by
`npm run vendor:three`.

| Module | Role |
|---|---|
| `engine.js` | One renderer, scene and camera; layout from the real `#main` gutters; the ambient world; reconciling the network; effects; the loop; lifecycle |
| `pasta-strand.js` | `PastaStrand`: a `TubeGeometry` on a `CatmullRomCurve3`, toon-shaded with an ink outline. Wobble, growth and pulses are shader uniforms, so geometry is rebuilt only on layout changes |
| `connection-curve.js` | `ConnectionCurve`: stable id, endpoints, state (`connecting`, `connected`, `transmitting`, `disconnected`, `reconnecting`) and a loop in the path |
| `device-node.js` | `DeviceNode`: desktop, laptop, smartphone, tablet and generic. Toon slabs with an ink hull, a status light, a float, a pop-in and a confirmation ring; geometry is shared per type |
| `particle-system.js` | `ParticleSystem`: a fixed `InstancedMesh` pool, nothing allocated per frame. Text uses round dots; images and video use orange cubes |
| `materials.js` | The strand shader, the toon ramp and the shared device materials |
| `performance.js` | Low, Medium and High profiles from several weak hints, plus a frame-time governor that steps down at a sustained frame rate under ~40 fps |

The canvas lives in `.visual-stage`, fixed behind the HTML with
`pointer-events: none`. On narrow screens it is a masked band at the top at 50%
opacity. It loads after `load` plus idle, so the controls never wait for it.

## Phase 3: events

`public/js/bus.js` (`PasttyBus`) is fed by `app.js` only at confirmed points:

| Event | Emitted on |
|---|---|
| `session:created` | `session_created` |
| `session:joined` | `session_joined` (`connectedDevices`) |
| `device:connected` / `device:disconnected` | `device_connected` / `device_disconnected`, `peer_disconnected` |
| `device:reconnecting` / `device:reconnected` | the WS client's reconnect attempts / `session_resumed` |
| `connection:online` / `connection:offline` / `connection:failed` | the transport (informational; the reducer waits for a resume) |
| `transfer:started` | the local send succeeded (text, image, video) or `transfer_incoming` |
| `transfer:received` | `receive_clip`, `receive_image` |
| `transfer:completed` | `clip_sent` / `image_sent` (`confirmation: 'relayed'`), `transfer_complete` (`'complete'`) |
| `transfer:aborted` | either side aborted |
| `session:closed` / `session:expired` | `resetToHome()` / `session_expired` |

Payloads carry only counts, kinds, directions and local ids: never codes,
tokens or content. `public/js/visual/state.js` is a pure reducer (unit-tested)
that validates payloads, drops duplicates and out-of-order events, and returns
`{state, effects}`. `adapter.js` replays the bus history when the engine boots
late (for example, joining from a QR code), then follows live events.

## Phase 4: Remotion

The five spec compositions are in `motion/src/compositions/`. They are
retoned to the warm palette and rendered to `public/assets/motion/`, as listed
in `motion/README.md`. The showcase plays BrandIntro plus four short clips
that rest and replay. They are explanatory assets on the landing page and are
**not** played on live events. A transparent video would need a separate HEVC
file for Safari, and the live layer already represents those moments.

## Phase 5: optimisation and verification

- Quality profiles plus the governor: the pixel ratio drops first, then particle
  caps, then ambient strands.
- Lifecycle: `visibilitychange`, `pagehide` and `pageshow` stop and start the
  loop. `resize` and a `ResizeObserver` on `#main` relayout.
  `webglcontextlost` falls back to the static image, and `webglcontextrestored`
  goes live again. The socket is untouched by any of it.
- `prefers-reduced-motion` (also changed live), Save-Data, no WebGL or a failed
  load all keep the static composition and download no Three.js.
- `window.PasttyVisual.{init, destroy, status, debug}` exists for tests;
  `debug()` holds no codes or content.

Verification:

```bash
npm test                                   # includes tests/client/visual-state.test.js
npm run e2e:visual -- http://localhost:3000/
cd motion && npm run e2e -- http://localhost:3000
```

`scripts/e2e-visual.mjs` drives real sessions across up to five browser contexts
and checks the acceptance criteria:
- controls are ready first;
- the canvas never takes clicks;
- create and join flows are reflected in the scene;
- transfers run in both directions;
- one device leaving dims only its strand;
- reconnection is shown only after the server confirms it;
- five devices produce no runaway objects;
- a hidden tab stops rendering;
- the scene survives a context loss and a restore;
- destroy/init is clean;
- the fallbacks for reduced motion, a blocked three.js and no WebGL all work;
- the mobile band works.

### Known limits

- Peer identity is not in the protocol, so peers render as generic devices and
  the most recently added peer slot is the one dimmed on a disconnect.
- Firefox and Safari were not available on the build machine. The e2e runs
  Firefox with `BROWSERS=chromium,firefox` once it is installed. WebKit/Safari
  still needs a manual check.
- Headless runs use software WebGL (SwiftShader), so their frame rates say
  nothing about real devices.
