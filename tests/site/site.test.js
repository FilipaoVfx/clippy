import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSite, fileFor, pages } from '../../scripts/build-site.mjs';
import { AD_FREE, ADS, CONTACT_EMAIL, LIMITS, ORIGIN, PUBLIC_DIR } from '../../site/config.mjs';

const { files, stale } = buildSite();
const html = (file) => files.get(file);
const pageHtml = (page) => html(fileFor(page.path));
const attr = (source, re) => source.match(re)?.[1];
const decode = (s) => s.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>');

describe('generated site', () => {
  it('is committed up to date (run `npm run site:build` after editing site/)', () => {
    expect(stale).toEqual([]);
    for (const [file, content] of files) {
      const path = resolve(PUBLIC_DIR, file);
      expect(existsSync(path), `public/${file} is missing`).toBe(true);
      expect(readFileSync(path, 'utf8') === content, `public/${file} is out of date`).toBe(true);
    }
  });

  it('has every page in English and Spanish', () => {
    const ids = new Set(pages.map((p) => p.id));
    for (const id of ids) {
      expect(pages.filter((p) => p.id === id).map((p) => p.lang).sort()).toEqual(['en', 'es']);
    }
  });

  it.each(pages.map((p) => [p.path, p]))('%s has sound head tags', (path, page) => {
    const source = pageHtml(page);
    const title = decode(attr(source, /<title>([^<]+)<\/title>/));
    const description = decode(attr(source, /<meta name="description" content="([^"]+)">/));
    expect(title.length, title).toBeLessThanOrEqual(60);
    expect(description.length, description).toBeGreaterThanOrEqual(110);
    expect(description.length, description).toBeLessThanOrEqual(160);
    expect(attr(source, /<link rel="canonical" href="([^"]+)">/)).toBe(ORIGIN + path);
    expect(attr(source, /<html lang="([^"]+)">/)).toBe(page.lang);
    // The app page has one <h1> per view (home, waiting, connected); only one is shown.
    if (!page.external) expect(source.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(source).not.toMatch(/name="robots" content="noindex/);

    // hreflang: each alternate points back, plus x-default to English.
    const alts = [...source.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
    const twin = pages.find((p) => p.id === page.id && p.lang !== page.lang);
    expect(alts).toContainEqual([page.lang, ORIGIN + path]);
    expect(alts).toContainEqual([twin.lang, ORIGIN + twin.path]);
    expect(alts).toContainEqual(['x-default', ORIGIN + pages.find((p) => p.id === page.id && p.lang === 'en').path]);
    expect(pageHtml(twin)).toContain(`hreflang="${page.lang}" href="${ORIGIN + path}"`);

    for (const block of source.matchAll(/<script type="application\/ld\+json">(.+?)<\/script>/g)) {
      expect(() => JSON.parse(block[1])).not.toThrow();
    }
  });

  it('uses unique titles and descriptions', () => {
    const titles = pages.map((p) => p.title);
    const descriptions = pages.map((p) => p.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('links only to pages and files that exist', () => {
    const paths = new Set(pages.map((p) => p.path));
    for (const [file, source] of files) {
      if (!file.endsWith('.html')) continue;
      for (const [, href] of source.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
        const ok = paths.has(href) || existsSync(resolve(PUBLIC_DIR, href.slice(1)));
        expect(ok, `${file} → ${href}`).toBe(true);
      }
    }
  });

  it('lists every page once in the sitemap, with alternates and a lastmod', () => {
    const xml = html('sitemap.xml');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual(pages.map((p) => ORIGIN + p.path).sort());
    expect(xml.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g)).toHaveLength(pages.length);
    expect(xml).not.toMatch(/changefreq|priority/);
    expect(xml).not.toContain('404');
  });

  it('keeps the 404 page out of the index', () => {
    expect(html('404.html')).toContain('<meta name="robots" content="noindex">');
  });

  it('robots.txt allows crawling and points at the sitemap', () => {
    const robots = readFileSync(resolve(PUBLIC_DIR, 'robots.txt'), 'utf8');
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).not.toMatch(/^Disallow: \/$/m);
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('states the limits from wrangler.toml', () => {
    const limits = pageHtml(pages.find((p) => p.id === 'limits' && p.lang === 'en'));
    for (const value of [LIMITS.text, LIMITS.image, LIMITS.video, `${LIMITS.devices} per room`]) {
      expect(limits).toContain(value);
    }
  });

  it('never claims end-to-end encryption or storage it does not have', () => {
    for (const page of pages) {
      const text = pageHtml(page).replace(/<[^>]+>/g, ' ');
      expect(text).not.toMatch(/\bis end-to-end encrypted\b|\bsecure\b(?! WebSockets)/i);
      expect(text).not.toMatch(/(?<!no )\bes cifrado de extremo a extremo\b/i);
    }
  });
});

describe('legal and contact pages', () => {
  it('exist in both languages and are linked from every footer', () => {
    for (const id of ['about', 'contact', 'privacy', 'terms', 'cookies']) {
      for (const lang of ['en', 'es']) {
        const page = pages.find((p) => p.id === id && p.lang === lang);
        expect(page, `${id}/${lang}`).toBeTruthy();
        expect(html('index.html')).toContain(`href="${pages.find((p) => p.id === id && p.lang === 'en').path}"`);
        expect(pageHtml(pages.find((p) => p.id === 'faq' && p.lang === lang))).toContain(`href="${page.path}"`);
      }
    }
  });

  it('give a way to reach the owner', () => {
    for (const id of ['contact', 'privacy', 'terms']) {
      for (const lang of ['en', 'es']) {
        expect(pageHtml(pages.find((p) => p.id === id && p.lang === lang))).toContain(`mailto:${CONTACT_EMAIL}`);
      }
    }
  });

  it('show the same "last updated" date as the sitemap', () => {
    const xml = html('sitemap.xml');
    for (const page of pages.filter((p) => p.showUpdated)) {
      const date = attr(pageHtml(page), /class="page-updated">[^<]+<time datetime="([^"]+)"/);
      expect(date, page.path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(xml).toContain(`<loc>${ORIGIN + page.path}</loc>\n    <lastmod>${date}</lastmod>`);
    }
  });
});

describe('ads', () => {
  const AD_CODE = /adsbygoogle|googlesyndication/;
  const CLIENT = 'ca-pub-1234567890123456';
  // Ad-free ids are slipped into `pages` on purpose: they must still be skipped.
  const FAKE = { client: CLIENT, serve: true, slot: '1234567890', pages: [...ADS.pages, ...AD_FREE] };
  const on = buildSite({ ads: FAKE }).files;
  const verifying = buildSite({ ads: { ...FAKE, serve: false } }).files;
  const fileOf = (id, lang) => fileFor(pages.find((p) => p.id === id && p.lang === lang).path);

  it('match the committed config: no ad code until serve is on', () => {
    const serving = Boolean(ADS.serve && ADS.client);
    for (const [name, source] of files) {
      if (!serving) expect(source, name).not.toMatch(AD_CODE);
    }
    expect(files.has('ads.txt')).toBe(Boolean(ADS.client));
    expect(ADS.pages.filter((id) => AD_FREE.includes(id))).toEqual([]);
  });

  it('never load on the app, the home pages, legal pages or the 404', () => {
    for (const id of AD_FREE) {
      for (const lang of ['en', 'es']) expect(on.get(fileOf(id, lang)), `${id}/${lang}`).not.toMatch(AD_CODE);
    }
    expect(on.get('index.html')).not.toMatch(AD_CODE);
    expect(on.get('404.html')).not.toMatch(AD_CODE);
  });

  it('load on guide pages with one or two labelled units, never above the first section', () => {
    for (const id of ADS.pages) {
      for (const lang of ['en', 'es']) {
        const source = on.get(fileOf(id, lang));
        expect(source).toContain(`adsbygoogle.js?client=${CLIENT}" crossorigin="anonymous"`);
        expect(source).toContain('<script defer src="/js/ads.js"></script>');
        const units = source.match(/<ins class="adsbygoogle"/g) ?? [];
        expect(units.length).toBeGreaterThanOrEqual(1);
        expect(units.length).toBeLessThanOrEqual(2);
        expect(source).toMatch(/<span class="ad-label">(Advertisements|Anuncios)<\/span>/);
        expect(source.indexOf('class="ad-slot"')).toBeGreaterThan(source.indexOf('</section>'));
      }
    }
  });

  it('verify the site and publish ads.txt as soon as a client is set, before any ad loads', () => {
    expect(verifying.get('ads.txt')).toBe('google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
    for (const [name, source] of verifying) {
      if (!name.endsWith('.html') || name === '404.html') continue;
      expect(source, name).toContain(`<meta name="google-adsense-account" content="${CLIENT}">`);
      expect(source, name).not.toMatch(AD_CODE);
    }
  });

  it('switch Privacy, Cookies, Terms and About to the copy that matches', () => {
    for (const lang of ['en', 'es']) {
      for (const id of ['privacy', 'cookies', 'about']) {
        expect(verifying.get(fileOf(id, lang)), `${id}/${lang} off`).not.toContain('AdSense');
        expect(on.get(fileOf(id, lang)), `${id}/${lang} on`).toContain('Google AdSense');
      }
      expect(on.get(fileOf('privacy', lang))).toContain('https://myadcenter.google.com/');
      expect(on.get(fileOf('cookies', lang))).toContain('https://optout.aboutads.info/');
      expect(on.get(fileOf('cookies', lang))).toContain('https://policies.google.com/technologies/partner-sites');
      expect(on.get(fileOf('terms', lang))).toMatch(/servidos por Google|served by Google/);
    }
  });

  it('refuse a malformed publisher id', () => {
    expect(() => buildSite({ ads: { ...FAKE, client: 'pub-1234' } })).toThrow(/ca-pub-/);
  });
});
