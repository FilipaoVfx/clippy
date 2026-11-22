#!/usr/bin/env node
/**
 * Crawls a running Pastty the way a search engine would and fails on anything
 * that would hurt indexing:
 *
 *   npm run seo:check -- https://pastty.com
 *   npm run seo:check -- http://localhost:8787
 *
 * Checks robots.txt, sitemap.xml (content type, URLs), that every sitemap URL
 * answers 200 with a self-canonical and reciprocal hreflang, that unknown
 * pages answer a real 404, and (for the production host) that www redirects.
 */
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init, headers: { accept: 'text/html,*/*', ...init.headers } });
// Sitemap URLs are absolute production URLs; test them against `base`.
const local = (url) => new URL(url).pathname;

const robots = await get('/robots.txt');
const robotsText = await robots.text();
check('robots.txt is plain text', robots.ok && /text\/plain/.test(robots.headers.get('content-type')), robots.headers.get('content-type'));
check('robots.txt declares the sitemap', /^Sitemap: https:\/\/pastty\.com\/sitemap\.xml$/m.test(robotsText));
// Only the groups for every crawler (User-agent: *) matter here; hosts such as
// Cloudflare may prepend their own groups for specific AI bots.
const groups = [];
for (const line of robotsText.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)) {
  const [key, ...rest] = line.split(':');
  const value = rest.join(':').trim();
  if (/^user-agent$/i.test(key)) {
    const last = groups.at(-1);
    if (last && last.rules.length === 0) last.agents.push(value);
    else groups.push({ agents: [value], rules: [] });
  } else if (groups.length) groups.at(-1).rules.push([key.toLowerCase(), value]);
}
const everyone = groups.filter((g) => g.agents.includes('*'));
check('robots.txt does not block the site', everyone.length > 0 && !everyone.some((g) => g.rules.some(([k, v]) => k === 'disallow' && v === '/')));

const sm = await get('/sitemap.xml');
const xml = await sm.text();
check('sitemap.xml is XML', sm.ok && /xml/.test(sm.headers.get('content-type')), sm.headers.get('content-type'));
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('sitemap lists pages', urls.length > 1, `${urls.length} URLs`);

const canonicalOf = new Map();
for (const url of urls) {
  const res = await get(local(url));
  const html = await res.text();
  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  const noindex = /<meta name="robots" content="[^"]*noindex/.test(html) || /noindex/.test(res.headers.get('x-robots-tag') || '');
  canonicalOf.set(url, html);
  check(`${local(url)} → 200, self-canonical, indexable`, res.status === 200 && canonical === url && !noindex,
    `${res.status}${canonical !== url ? ` canonical=${canonical}` : ''}${noindex ? ' noindex' : ''}`);
}
for (const [url, html] of canonicalOf) {
  const alts = [...html.matchAll(/<link rel="alternate" hreflang="(en|es)" href="([^"]+)">/g)];
  const ok = alts.every(([, , href]) => (canonicalOf.get(href) || '').includes(`href="${url}"`));
  if (!ok) check(`${local(url)} hreflang is reciprocal`, false);
}
check('hreflang pairs are reciprocal', true);

const missing = await get('/this-page-does-not-exist');
const missingBody = await missing.text();
check('unknown page → 404 (no soft 404)', missing.status === 404, String(missing.status));
check('404 page is HTML with noindex', /<html/.test(missingBody) && /noindex/.test(missingBody));

const legacy = await get('/join?code=ABC-12D');
check('stray paths with a code open the app', legacy.status === 302 && /\/\?code=ABC-12D$/.test(legacy.headers.get('location') || ''), `${legacy.status} ${legacy.headers.get('location')}`);

if (new URL(base).hostname === 'pastty.com') {
  const www = await fetch('https://www.pastty.com/faq', { redirect: 'manual' }).catch((e) => ({ status: e.message }));
  check('www.pastty.com → 301 to pastty.com', www.status === 301 && www.headers.get('location') === 'https://pastty.com/faq', `${www.status} ${www.headers?.get?.('location') ?? ''}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
