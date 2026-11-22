import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSite, fileFor, pages } from '../../scripts/build-site.mjs';
import { LIMITS, ORIGIN, PUBLIC_DIR } from '../../site/config.mjs';

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
