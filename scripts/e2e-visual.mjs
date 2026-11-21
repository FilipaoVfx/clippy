#!/usr/bin/env node
// End-to-end checks for the Three.js visual layer (docs/visual-engine.md),
// mapped to the acceptance criteria of the visual spec. Drives real sessions
// between several browser contexts against a running server.
//
//   npm run e2e:visual -- http://localhost:3000/
//
// Needs a Chrome/Chromium binary (CHROME=/path, or one found in the
// puppeteer / ms-playwright caches). Firefox runs too when installed via
// `npx playwright install firefox` (BROWSERS=chromium,firefox).
import { chromium, firefox } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const BASE = (process.argv[2] || 'http://localhost:3000/').replace(/\/?$/, '/');
const OUT = join(process.cwd(), 'out/e2e-visual');
mkdirSync(OUT, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [join(homedir(), '.cache/puppeteer/chrome'), join(homedir(), '.cache/ms-playwright')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = join(root, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the page until fn() is truthy (scene time advances slowly in software GL). */
async function until(page, fn, arg, timeout = 15000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
}

const debug = (page) => page.evaluate(() => window.PasttyVisual?.debug());

// Records every WebSocket so a test can drop one the way a network would.
const SOCKET_TAP = () => {
  const Native = window.WebSocket;
  window.__sockets = [];
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      window.__sockets.push(this);
    }
  };
};

function tinyPng() {
  // 2x2 opaque PNG, built by hand so the test needs no fixtures.
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 200, 87, 255, 200, 87, 0, 255, 150, 61, 255, 150, 61]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function newPage(browser, opts = {}, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(SOCKET_TAP);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return page;
}

async function createRoom(page) {
  await page.goto(BASE);
  await page.click('#btn-create');
  await page.waitForSelector('#view-waiting.active', { timeout: 15000 });
  return (await page.textContent('#code-text')).trim();
}

async function joinRoom(browser, code, errors, opts) {
  const page = await newPage(browser, opts, errors);
  await page.goto(`${BASE}?code=${encodeURIComponent(code)}`);
  await page.waitForSelector('#view-connected.active', { timeout: 15000 });
  return page;
}

const live = (page) => until(page, () => window.PasttyVisual?.status() === 'live', null, 20000);

async function mainFlow(browser, name) {
  console.log(`\n[${name}] live session across devices`);
  const errors = [];
  const a = await newPage(browser, {}, errors);
  await a.goto(BASE);

  // 1. Controls are usable before (and regardless of) the 3D layer.
  const early = await a.evaluate(() => ({
    status: window.PasttyVisual?.status(),
    createEnabled: !document.getElementById('btn-create').disabled,
  }));
  check('controls ready before Three.js', early.createEnabled && early.status !== 'live', `status at DOMContentLoaded: ${early.status}`);

  // Some engines here have no WebGL at all (headless Firefox on a GPU-less
  // server). Then the job is the fallback: the full app on the static scene.
  await until(a, () => (window.PasttyVisual?.status() || '').match(/^(live|off:|error)/), null, 20000);
  if ((await a.evaluate(() => window.PasttyVisual.status())) === 'off:no-webgl') {
    console.log('  · this browser has no WebGL here: checking the fallback path');
    const fb = await a.evaluate(() => ({ live: document.body.classList.contains('visual-live'), bg: getComputedStyle(document.querySelector('.device-scene')).opacity }));
    check('no WebGL -> static composition visible', !fb.live && Number(fb.bg) > 0.5, JSON.stringify(fb));
    await a.click('#btn-create');
    await a.waitForSelector('#view-waiting.active');
    const fcode = (await a.textContent('#code-text')).trim();
    const fb2 = await joinRoom(browser, fcode, errors);
    await a.waitForSelector('#view-connected.active');
    await a.fill('#input-clip', 'hola sin WebGL');
    await a.click('#btn-send');
    check('no WebGL -> pair and send text work', await fb2.waitForSelector('.clip-feed :text("hola sin WebGL")', { timeout: 10000 }).then(() => true, () => false));
    check('no console errors (no WebGL)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await a.screenshot({ path: join(OUT, `${name}-fallback-connected.png`) });
    await a.context().close();
    await fb2.context().close();
    return;
  }
  check('engine goes live', await live(a));
  const stage = await a.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.visual-stage'));
    const btn = document.getElementById('btn-create').getBoundingClientRect();
    const hit = document.elementFromPoint(btn.x + btn.width / 2, btn.y + btn.height / 2);
    return { pe: s.pointerEvents, z: s.zIndex, hit: hit?.closest('#btn-create') !== null };
  });
  check('canvas never takes pointer events', stage.pe === 'none' && stage.hit, `pointer-events=${stage.pe} z=${stage.z}`);
  await sleep(1200);
  await a.screenshot({ path: join(OUT, `${name}-1-idle.png`) });
  const idle = await debug(a);
  check('idle: ambient strands, no fake devices online', idle.ambient > 0 && idle.self === null && idle.peers.length === 0, `ambient=${idle.ambient}`);

  // 4. Session created -> this device + searching strand.
  await a.click('#btn-create');
  await a.waitForSelector('#view-waiting.active');
  const code = (await a.textContent('#code-text')).trim();
  check('session created -> this device appears, searching strand', await until(a, () => {
    const d = window.PasttyVisual.debug();
    return d.self && d.searching && d.self.status === 'waiting';
  }));
  const dbgCode = JSON.stringify(await debug(a));
  check('pairing code stays out of the visual layer', !dbgCode.includes(code));
  await sleep(800);
  await a.screenshot({ path: join(OUT, `${name}-2-waiting.png`) });

  // 5. A second real device -> node + connection grows to completion.
  const b = await joinRoom(browser, code, errors);
  check('peer joins -> node and strand, fully grown', await until(a, () => {
    const d = window.PasttyVisual.debug();
    return d.peers.length === 1 && d.peers[0].node === 'connected' && d.peers[0].progress === 1 && !d.searching;
  }));
  check('joiner (engine booted after joining) replays state', await live(b) && await until(b, () => {
    const d = window.PasttyVisual.debug();
    return d.phase === 'connected' && d.peers.length === 1;
  }));
  await sleep(600);
  await a.screenshot({ path: join(OUT, `${name}-3-connected.png`) });

  // 6. Transfers ride the connection in the right direction.
  await a.fill('#input-clip', 'hola desde A');
  await a.click('#btn-send');
  check('text sent -> particles leave this device', await until(a, () => window.PasttyVisual.debug().particles.text > 0, null, 5000));
  check('text received -> particles arrive on the peer', await until(b, () => window.PasttyVisual.debug().particles.text > 0, null, 5000));
  await a.screenshot({ path: join(OUT, `${name}-4-sending.png`) });
  await b.setInputFiles('#input-image', { name: 'dot.png', mimeType: 'image/png', buffer: tinyPng() });
  check('image sent -> media particles (distinct from text)', await until(b, () => window.PasttyVisual.debug().particles.media > 0, null, 5000));
  check('image received on the other side', await until(a, () => window.PasttyVisual.debug().particles.media > 0, null, 5000));

  // 7. Three devices; one leaves -> only its node and strand change.
  const c = await joinRoom(browser, code, errors);
  check('third device -> second peer', await until(a, () => window.PasttyVisual.debug().peers.filter((p) => p.node === 'connected').length === 2));
  const geoBefore = (await debug(a)).geometries;
  await c.context().close();
  check('one device leaves -> only that slot dims', await until(a, () => {
    const p = window.PasttyVisual.debug().peers;
    return p.length === 2 && p.filter((x) => x.node === 'disconnected').length === 1 && p.filter((x) => x.node === 'connected').length === 1;
  }));
  await sleep(800);
  await a.screenshot({ path: join(OUT, `${name}-5-one-left.png`) });

  // 8. Reconnection: drop B's socket like a flaky network, restore after confirmation.
  await b.evaluate(() => window.__sockets.at(-1).close(4000, 'test drop'));
  check('dropped socket -> reconnecting state', await until(b, () => window.PasttyVisual.debug().self?.status === 'reconnecting', null, 5000));
  check('restored only after server confirms', await until(b, () => window.PasttyVisual.debug().self?.status === 'connected', null, 20000));

  // 9. Up to five devices, bounded objects.
  const d = await joinRoom(browser, code, errors);
  const e = await joinRoom(browser, code, errors);
  const f = await joinRoom(browser, code, errors);
  check('five devices -> four peer strands', await until(a, () => window.PasttyVisual.debug().peers.filter((p) => p.node === 'connected').length === 4));
  await sleep(1500);
  await a.screenshot({ path: join(OUT, `${name}-6-five.png`) });
  const full = await debug(a);
  check('no runaway objects', full.peers.length <= 4 && full.geometries < geoBefore + 12, `geometries ${geoBefore} -> ${full.geometries}`);
  for (const p of [d, e, f]) await p.context().close();

  // Hidden tab -> render loop pauses; visible -> resumes.
  const paused = await a.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const r1 = window.PasttyVisual.debug().running;
    const f1 = window.PasttyVisual.debug().frames;
    await new Promise((r) => setTimeout(r, 500));
    const f2 = window.PasttyVisual.debug().frames;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return { r1, idle: f2 - f1, r2: window.PasttyVisual.debug().running };
  });
  check('hidden tab stops rendering', paused.r1 === false && paused.idle === 0 && paused.r2 === true, JSON.stringify(paused));

  // 12. WebGL context loss -> static fallback; restore -> live again.
  const lost = await a.evaluate(async () => {
    const gl = document.querySelector('.visual-canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_lose_context');
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    const during = { status: window.PasttyVisual.status(), live: document.body.classList.contains('visual-live') };
    ext.restoreContext();
    return during;
  });
  check('context lost -> fallback composition', lost.status === 'lost' && !lost.live);
  check('context restored -> live again', await live(a));
  check('scene state survives a context loss', await until(a, () => window.PasttyVisual.debug().peers.length >= 1));

  // 13. Destroy and re-init without duplicating listeners or loops.
  const counts = [];
  for (let i = 0; i < 3; i += 1) {
    await a.evaluate(() => window.PasttyVisual.destroy());
    const gone = await a.evaluate(() => window.PasttyVisual.debug());
    await a.evaluate(() => window.PasttyVisual.init());
    await live(a);
    const back = await debug(a);
    counts.push(`${gone.busListeners}/${back.busListeners}/${back.listeners}`);
  }
  check('destroy/init is clean (bus listeners, DOM listeners)', new Set(counts).size === 1 && counts[0].startsWith('0/'), counts.join(' '));
  check('after re-init, scene rebuilt from real state', await until(a, () => window.PasttyVisual.debug().phase === 'connected'));

  // Session end -> network leaves, ambient returns.
  await a.click('#btn-disconnect');
  check('session closed -> back to idle scene', await until(a, () => {
    const dd = window.PasttyVisual.debug();
    return dd.phase === 'idle' && dd.self === null;
  }));

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await a.context().close();
  await b.context().close();
}

async function fallbacks(launch, name) {
  console.log(`\n[${name}] fallbacks`);

  // Reduced motion: no engine, three.js never downloaded, app works.
  {
    const browser = await launch();
    const errors = [];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const three = [];
    page.on('request', (r) => { if (r.url().includes('/vendor/three')) three.push(r.url()); });
    await page.goto(BASE);
    await sleep(2500);
    const st = await page.evaluate(() => window.PasttyVisual.status());
    check('reduced motion -> static composition, no engine', st === 'off:reduced-motion' && three.length === 0, st);
    const code = await createRoom(page);
    check('reduced motion -> sessions still work', /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code));
    check('no errors (reduced motion)', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  // Three.js fails to load: app untouched.
  {
    const browser = await launch();
    const errors = [];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/vendor/three.min.js', (r) => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE);
    await until(page, () => (window.PasttyVisual?.status() || '').match(/^(live|off:|error)/), null, 15000);
    const st = await page.evaluate(() => ({ status: window.PasttyVisual.status(), live: document.body.classList.contains('visual-live'), bg: getComputedStyle(document.querySelector('.device-scene')).opacity }));
    check('three.js blocked -> static composition stays', (st.status === 'error' || st.status === 'off:no-webgl') && !st.live && Number(st.bg) > 0.5, JSON.stringify(st));
    const code = await createRoom(page);
    check('three.js blocked -> create room still works', /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code));
    check('no uncaught errors (three.js blocked)', errors.length === 0, errors.join(' | '));
    await browser.close();
  }
}

async function noWebgl(executablePath) {
  console.log('\n[chromium] no WebGL');
  const browser = await chromium.launch({ executablePath, args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(BASE);
  await sleep(2500);
  const st = await page.evaluate(() => window.PasttyVisual.status());
  check('no WebGL -> static composition', st === 'off:no-webgl', st);
  const code = await createRoom(page);
  check('no WebGL -> sessions still work', /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code));
  await browser.close();
}

async function mobile(browser, name) {
  console.log(`\n[${name}] mobile`);
  const errors = [];
  const page = await newPage(browser, {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: name === 'chromium', hasTouch: true,
  }, errors);
  await page.goto(BASE);
  await until(page, () => (window.PasttyVisual?.status() || '').match(/^(live|off:|error)/), null, 20000);
  const noGl = (await page.evaluate(() => window.PasttyVisual.status())) === 'off:no-webgl';
  check(noGl ? 'mobile: no WebGL -> static fallback' : 'mobile: engine live', noGl || await live(page));
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    profile: window.PasttyVisual.debug().profile ?? null,
    wide: window.PasttyVisual.debug().wide ?? null,
    h: document.querySelector('.visual-stage').getBoundingClientRect().height,
  }));
  check('mobile: compact band, no horizontal scroll', !m.overflow && (noGl || (!m.wide && m.h <= 700)), JSON.stringify(m));
  await sleep(1000);
  await page.screenshot({ path: join(OUT, `${name}-mobile-idle.png`) });
  await page.tap('#btn-create');
  check('mobile: create room by tap', await page.waitForSelector('#view-waiting.active', { timeout: 15000 }).then(() => true, () => false));
  await sleep(800);
  await page.screenshot({ path: join(OUT, `${name}-mobile-waiting.png`) });
  check('mobile: no console errors', errors.length === 0, errors.join(' | '));
  await page.context().close();
}

const executablePath = findChrome();
const wanted = (process.env.BROWSERS || 'chromium').split(',');
console.log(`Visual e2e against ${BASE}`);

if (wanted.includes('chromium')) {
  const launch = () => chromium.launch({ executablePath, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const browser = await launch();
  await mainFlow(browser, 'chromium');
  await mobile(browser, 'chromium');
  await browser.close();
  await fallbacks(launch, 'chromium');
  await noWebgl(executablePath);
}

if (wanted.includes('firefox')) {
  const launch = () => firefox.launch();
  const browser = await launch();
  await mainFlow(browser, 'firefox');
  await mobile(browser, 'firefox');
  await browser.close();
  await fallbacks(launch, 'firefox');
}

console.log(failures ? `\n${failures} check(s) failed. Screenshots in ${OUT}` : `\nAll visual checks passed. Screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
