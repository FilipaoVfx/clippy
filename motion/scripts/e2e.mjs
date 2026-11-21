#!/usr/bin/env node
/**
 * End-to-end check of the motion showcase against a running site.
 *
 *   npm run e2e -- http://127.0.0.1:3110
 *   CHROME=/path/to/chrome npm run e2e -- https://preview.example
 *
 * Needs a Chrome/Chromium binary (CHROME, or one found in the Puppeteer /
 * Playwright caches). Chrome for Testing is preferred: it decodes H.264, so
 * the MP4 fallback is exercised too. Exits 1 on any failed assertion.
 */
import {existsSync, mkdirSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromium, devices} from 'playwright-core';

const base = (process.argv[2] || 'http://127.0.0.1:3110').replace(/\/$/, '');
const shots = join(import.meta.dirname, '..', 'out', 'e2e');
mkdirSync(shots, {recursive: true});

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [
    [join(homedir(), '.cache/puppeteer/chrome'), 'chrome-linux64/chrome'],
    [join(homedir(), '.cache/ms-playwright'), 'chrome-linux64/chrome'],
  ];
  for (const [root, rel] of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).sort().reverse()) {
      const p = join(root, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chrome found: set CHROME=/path/to/chrome');
}
const executablePath = findChrome();

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

/** Per-video state plus a 64×36 luminance sample of the current frame. */
const probe = (page) =>
  page.$$eval('video[data-motion]', (vs) =>
    vs.map((v) => {
      let mean = 0, sd = 0;
      try {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 36;
        const g = c.getContext('2d');
        g.drawImage(v, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let s = 0, s2 = 0;
        for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; }
        const n = d.length / 4; mean = s / n; sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      } catch { /* not decodable yet */ }
      return {src: (v.currentSrc || '').split('/').pop(), paused: v.paused, ended: v.ended, t: v.currentTime, dur: v.duration, ready: v.readyState, err: v.error?.code ?? null, mean, sd};
    }),
  );

async function session(name, contextOptions, fn) {
  console.log(`\n▸ ${name}`);
  const browser = await chromium.launch({executablePath});
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED/.test(m.text()) && errors.push(m.text()));
  const motionRequests = [];
  page.on('request', (r) => r.url().includes('/assets/motion/') && /\.(mp4|webm)$/.test(r.url()) && motionRequests.push(r.url().split('/').pop()));
  try {
    await fn(page, {motionRequests});
    check(errors.length === 0, 'no page or console errors', errors.join(' | '));
  } finally {
    await browser.close();
  }
}

async function showcaseChecks(page, label, {expectExt}) {
  await page.goto(base + '/', {waitUntil: 'networkidle'});
  const before = await probe(page);
  check(before.every((v) => !v.src), 'clips are not fetched before scrolling');

  await page.locator('.motion-stage').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const v = document.querySelector('.motion-stage video');
    return v && !v.paused && v.currentTime > 0.5;
  }, null, {timeout: 20000}).catch(() => {});
  const a = (await probe(page))[0];
  await page.waitForTimeout(1500);
  const b = (await probe(page))[0];
  check(a.src.endsWith(expectExt), `brand intro uses ${expectExt}`, a.src || 'no source');
  check(!b.paused && b.t > a.t + 1, 'brand intro plays and advances', `${a.t.toFixed(2)}s → ${b.t.toFixed(2)}s`);
  check(b.sd > 10, 'brand intro frame is not blank', `sd=${b.sd.toFixed(1)}`);
  check(Math.abs(b.dur - 5) < 0.2, 'brand intro lasts 5 s', `${b.dur}`);
  await page.locator('.motion-stage').screenshot({path: join(shots, `${label}-brand.png`)});

  const hero = page.locator('.motion-stage video');
  // Clips are short: they rest on the last frame (ended), then replay.
  await hero.evaluate((v) => {
    window.__rest = [];
    v.addEventListener('ended', () => window.__rest.push(['ended', performance.now()]));
    v.addEventListener('play', () => window.__rest.push(['play', performance.now(), v.currentTime]));
    v.currentTime = v.duration - 0.3;
    v.play().catch(() => {}); // it may have been resting at the end already
  });
  await page.waitForFunction(() => {
    const e = window.__rest.findIndex(([k]) => k === 'ended');
    return e >= 0 && window.__rest.slice(e).some(([k]) => k === 'play');
  }, null, {timeout: 8000}).catch(() => {});
  const rest = await page.evaluate(() => window.__rest);
  const endAt = rest.find(([k]) => k === 'ended')?.[1];
  const playAt = rest.find(([k, at]) => k === 'play' && at > (endAt ?? Infinity));
  const rested = endAt !== undefined;
  const replayed = Boolean(playAt) && playAt[2] < 1.5;
  const gap = playAt && endAt ? Math.round(playAt[1] - endAt) : -1;
  check(rested && replayed && gap >= 500, 'brand intro rests on its last frame, then replays', `rest ${gap} ms`);


  const toggle = page.locator('[data-motion-toggle]');
  await toggle.click();
  await page.waitForTimeout(250);
  check((await toggle.getAttribute('aria-pressed')) === 'true' && (await hero.evaluate((v) => v.paused)), 'pause button pauses');
  await toggle.click();
  await page.waitForTimeout(400);
  check((await toggle.getAttribute('aria-pressed')) === 'false' && (await hero.evaluate((v) => !v.paused || v.ended)), 'play button resumes');

  const cards = await page.locator('.motion-card').all();
  for (const [i, card] of cards.entries()) {
    await card.scrollIntoViewIfNeeded();
    await page.waitForFunction((k) => {
      const v = document.querySelectorAll('.motion-card video')[k];
      return v && !v.paused && v.currentTime > 0.3;
    }, i, {timeout: 15000}).catch(() => {});
    const v = (await probe(page))[i + 1];
    check((!v.paused || v.ended) && v.err === null && v.ready >= 2, `chapter ${i + 1} plays`, `${v.src} t=${v.t.toFixed(2)}${v.ended ? ' (resting)' : ''}`);
    await card.screenshot({path: join(shots, `${label}-chapter${i + 1}.png`)});
  }

  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(800);
  const playing = (await probe(page)).filter((v) => !v.paused).length;
  check(playing === 0, 'clips pause when scrolled away', `${playing} playing`);

  await page.click('#btn-create');
  await page.waitForFunction(() => /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(document.getElementById('code-text')?.textContent || ''), null, {timeout: 15000}).catch(() => {});
  const code = await page.textContent('#code-text');
  check(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code || ''), 'Create room still works', code);
  check(!(await page.locator('.motion-showcase').isVisible()), 'showcase hides inside a room');
}

await session('desktop · WebM', {viewport: {width: 1440, height: 900}}, (page) => showcaseChecks(page, 'desktop-webm', {expectExt: '.webm'}));

await session('desktop · MP4 fallback (WebM blocked)', {viewport: {width: 1440, height: 900}}, async (page) => {
  await page.route('**/*.webm', (r) => r.abort());
  await showcaseChecks(page, 'desktop-mp4', {expectExt: '.mp4'});
});

await session('phone · iPhone 13 viewport', {...devices['iPhone 13']}, async (page) => {
  await showcaseChecks(page, 'phone', {expectExt: '.webm'});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow <= 0, 'no horizontal scroll', `${overflow}px`);
});

await session('reduced motion', {viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'}, async (page, {motionRequests}) => {
  await page.goto(base + '/', {waitUntil: 'networkidle'});
  await page.locator('.motion-showcase').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  check(motionRequests.length === 0, 'no clip is downloaded', motionRequests.join(','));
  check((await page.locator('[data-motion-toggle]').getAttribute('aria-pressed')) === 'true', 'toggle offers Play');
  await page.locator('[data-motion-toggle]').click();
  await page.waitForTimeout(2500);
  check(!(await page.locator('.motion-stage video').evaluate((v) => v.paused)), 'Play starts the brand intro on request');
});

await session('MP4 and WebM colours match', {viewport: {width: 800, height: 600}}, async (page) => {
  await page.goto(base + '/', {waitUntil: 'networkidle'});
  const diff = await page.evaluate(async () => {
    const sample = (src) => new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.src = src;
      v.addEventListener('error', () => reject(new Error('cannot decode ' + src)));
      v.addEventListener('loadeddata', () => { v.currentTime = 3.5; }, {once: true});
      v.addEventListener('seeked', () => {
        const c = document.createElement('canvas'); c.width = 160; c.height = 90;
        const g = c.getContext('2d'); g.drawImage(v, 0, 0, 160, 90);
        const d = g.getImageData(0, 0, 160, 90).data; const m = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; }
        resolve(m.map((x) => x / (d.length / 4)));
      }, {once: true});
    });
    const [mp4, webm] = await Promise.all([sample('/assets/motion/brand.mp4'), sample('/assets/motion/brand.webm')]);
    return {mp4, webm, max: Math.max(...mp4.map((x, i) => Math.abs(x - webm[i])))};
  });
  check(diff.max < 5, 'same colour in both formats', `max channel Δ=${diff.max.toFixed(1)} mp4=${diff.mp4.map((x) => x.toFixed(0))} webm=${diff.webm.map((x) => x.toFixed(0))}`);
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll showcase checks passed');
process.exit(failures ? 1 : 0);
