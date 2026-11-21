/**
 * Boots the Three.js layer once the page is usable, or not at all.
 *
 * The HTML app never waits for this. Without WebGL, with reduced motion or
 * Save-Data, or if anything here fails, the static composition
 * (.device-scene) stays and every control works the same.
 *
 * window.PasttyVisual exposes init/destroy/debug for tests (no secrets: the
 * engine never sees codes, tokens or content).
 */
const host = document.querySelector('.visual-stage');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let engine = null;
let adapter = null;
let status = 'idle';
let pending = null;

function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function blocker() {
  if (!host || !window.PasttyBus) return 'unavailable';
  if (reducedMotion.matches) return 'reduced-motion';
  if (navigator.connection?.saveData) return 'save-data';
  if (!webglAvailable()) return 'no-webgl';
  return null;
}

function setLive(on) {
  document.body.classList.toggle('visual-live', on);
}

async function init() {
  if (engine || pending) return pending;
  const blocked = blocker();
  if (blocked) {
    status = `off:${blocked}`;
    return null;
  }
  status = 'loading';
  pending = (async () => {
    try {
      const [{ Engine }, { pickProfile }, { createAdapter }] = await Promise.all([
        import('./three/engine.js'),
        import('./three/performance.js'),
        import('./adapter.js'),
      ]);
      // A fresh canvas every time: a canvas whose context was lost or
      // force-released cannot hand out a new one.
      const canvas = document.createElement('canvas');
      canvas.className = 'visual-canvas';
      host.replaceChildren(canvas);
      const profile = pickProfile({
        width: innerWidth,
        dpr: devicePixelRatio || 1,
        cores: navigator.hardwareConcurrency || 4,
        memory: navigator.deviceMemory || 4,
        coarse: matchMedia('(pointer: coarse)').matches,
        saveData: Boolean(navigator.connection?.saveData),
      });
      engine = new Engine(canvas, {
        profile,
        onLive: () => { status = 'live'; setLive(true); },
        onLost: () => { status = 'lost'; setLive(false); },
      }).init();
      adapter = createAdapter(window.PasttyBus, engine);
      engine.start();
    } catch (err) {
      console.warn('[visual] staying on the static composition:', err);
      status = 'error';
      teardown();
    } finally {
      pending = null;
    }
    return engine;
  })();
  return pending;
}

function teardown() {
  adapter?.destroy();
  try { engine?.destroy(); } catch { /* best effort */ }
  adapter = null;
  engine = null;
  host?.replaceChildren();
  setLive(false);
}

function destroy() {
  teardown();
  status = 'destroyed';
}

reducedMotion.addEventListener?.('change', () => {
  if (reducedMotion.matches) {
    teardown();
    status = 'off:reduced-motion';
  } else {
    init();
  }
});

window.PasttyVisual = Object.freeze({
  init,
  destroy,
  status: () => status,
  debug: () => (engine ? { ...engine.debug(), status, busListeners: window.PasttyBus.listenerCount() } : { status, busListeners: window.PasttyBus?.listenerCount() ?? 0 }),
});

// After the page has loaded and gone idle: controls first, scenery second.
function schedule() {
  const go = () => init();
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 });
  else setTimeout(go, 300);
}
if (document.readyState === 'complete') schedule();
else window.addEventListener('load', schedule, { once: true });
