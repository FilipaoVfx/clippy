# Pastty Motion

Motion identity for Pastty, built with [Remotion](https://www.remotion.dev/). It is
rendered **offline** into small static videos; the production site never loads
React, Remotion or a player. It only gets `public/assets/motion/*.{webm,mp4,webp}`.

## Visual language

- **Contemporary brutalism.** 5px ink outlines, hard offset shadows with no blur,
  Russo One display type that slams in glyph by glyph.
- **Playful 3D cartoon.** Warm pastel device slabs with an extruded side, a key light
  from the upper left, a glossy screen sweep and a soft contact shadow. They drop
  in with squash and stretch.
- **Warm environments.** Ivory, apricot, butter, pasta, peach and sand stages
  (the brand palette in `src/theme.ts`, never cold pastels) with a few geometric
  volumes that drift for parallax.
- **Spaghetti strands.** Pasta-yellow tubes that sag, breathe and tie a single
  loop (the Pastty mark). There are no plates, cutlery, kitchens or food: the
  strand is only ever a connection.
- **Grain and light.** A static film grain (kind to video encoders) and a vignette.

### Connection grammar

Every clip uses the same sequence when a link is established:

1. The strand grows organically from one device's port to the other.
2. An ignition flash runs along it and the **strand illuminates** (halo, hotter body).
3. **Particles accelerate.** Their speed is integrated per frame, so there is no jump,
   and their trails stretch with speed.
4. A small **sync indicator** pops in (`Syncing` → `Synced · 12 ms`).
5. Each **device confirms** with a mint check badge and a "Connected" screen.

When the connection drops, the strand snaps, goes grey and droops, and the indicator
turns to `Reconnecting`. On reconnect the ends reach back, relight, and the indicator
shows `Resumed`.

## Compositions

**Web** (shipped to `public/assets/motion/`, the five pieces of the visual spec):

| ID | Size | Length | Story |
|---|---|---|---|
| `BrandIntro` | 1920×1080 | 5 s | On ivory, a strand unfurls, ties the logo's loop and lights up; *Pastty.* lands with *Copy. Share. Sync.* |
| `SessionCreated` | 1080² | 2.2 s | This device lands; a strand reaches out and becomes the pairing card. The card has empty slots and never shows a fake code |
| `DevicePairing` | 1080² | 2.2 s | A second device arrives, the strand connects, lights up, and both confirm |
| `TransferSequence` | 1080² | 2.2 s | An abstract card (`contentType`: text, image or video; never real content) rides the strand while the particles speed up |
| `SyncConfirmation` | 1080² | 1.4 s | One pulse, a short accent and a clean ending |

**Social** (`npm run render:social` → `out/social/`, not shipped):
`HeroIntro` (12 s), `DeviceConnection`, `DataTransfer`, `MultiDevice` (one hub,
five devices) and `Reconnect` (drop and resume).

## Commands

```bash
npm install
npm run studio        # live preview in Remotion Studio
npm run typecheck
npm run render            # the five web pieces → out/master + ../public/assets/motion
npm run render -- BrandIntro
npm run render:social     # HeroIntro + the four long chapters → out/social
npm run render:stills     # social card (og-pastty.jpg) + the photo-guide figure → ../public/assets
```

`render` keeps concurrency at 2 and a 120 s `delayRender` timeout for this
2-CPU VPS. Outputs:

- `out/master/*.mp4`: high-quality masters of the web pieces. Not committed.
- `out/social/*.mp4`: longer captioned cuts for sharing. Not committed.
- `../public/assets/motion/`: VP9 WebM, H.264 MP4 (faststart) and WebP poster per clip.

Encoding converts Remotion's full-range masters (`yuvj420p`, bt470bg) to
limited-range BT.709 and tags it. Without that conversion, Chrome and Safari show
the MP4 washed out while the WebM looks right. `ENCODE_ONLY=1 npm run render`
re-encodes the existing masters without rendering again.

## End-to-end check

```bash
npm run e2e -- http://127.0.0.1:3110      # or the preview tunnel URL
```

It uses Chrome for Testing (`CHROME=...`, or found in the Puppeteer/Playwright
caches) and checks:

- **Loading:** no clip downloads before scrolling; each clip plays, advances and
  shows a non-blank frame once in view.
- **Playback:** the brand intro rests on its last frame and replays, and the
  pause/play control works; clips pause when scrolled away.
- **App:** Create room still works and the showcase hides inside a room.
- **Formats:** the MP4 fallback plays when WebM is blocked, and MP4 and WebM frames
  match in colour.
- **Phone and reduced motion:** a phone viewport has no horizontal scroll; with
  reduced motion no clip downloads until Play is pressed.

Exits 1 on any failure; screenshots land in `out/e2e/`.

## On the website

`public/js/motion.js` attaches sources only when a clip scrolls near, plays it
only while visible, and pauses it when the tab is hidden. Clips are short, so
each one rests on its last frame (`data-rest`, in ms) before replaying. With
`prefers-reduced-motion` or Save-Data on, every clip stays on its poster until the
visitor presses play. The service worker does not cache `/assets/motion/`. The
showcase sits **below** the pairing panel inside the home view, so it never
delays or covers the product and disappears once a room is open.
