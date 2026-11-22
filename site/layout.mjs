// Renders a content page from its data. No framework: plain template strings,
// escaped at the edges. Page copy may contain trusted inline HTML (<strong>,
// <a>, <kbd>); everything that lands in attributes or JSON-LD is escaped.
import { AD_FREE, ADS, CHROME, OG_IMAGE, ORIGIN } from './config.mjs';

export const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export const plain = (html) => String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
export const abs = (path) => ORIGIN + path;

const ARROW = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>';
const ADSENSE_SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const CLIENT_RE = /^ca-pub-\d{16}$/;

/**
 * What the ads config means for one page: whether ads serve anywhere (which
 * switches the legal copy), whether this page loads AdSense, and its unit id.
 */
export function adMode(page, ads = ADS) {
  if (ads.client && !CLIENT_RE.test(ads.client)) {
    throw new Error(`ADS.client must look like ca-pub-0123456789012345, got "${ads.client}"`);
  }
  const serving = Boolean(ads.serve && ads.client);
  const here = serving && !page.external && ads.pages.includes(page.id) && !AD_FREE.includes(page.id);
  return { serving, here, client: ads.client, slot: here ? ads.slot : null };
}

// Sections marked `ads: 'on'` or `ads: 'off'` show only in that mode, so the
// legal pages always describe what the site really does.
const visible = (sections, serving) => sections.filter((s) => !s.ads || (s.ads === 'on') === serving);

function adUnit(lang, mode) {
  const label = esc(CHROME[lang].adLabel);
  return `<aside class="ad-slot" aria-label="${label}"><span class="ad-label">${label}</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(mode.client)}" data-ad-slot="${esc(mode.slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins></aside>`;
}

function longDate(lang, iso) {
  const locale = lang === 'es' ? 'es-419' : 'en-US';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

const SUN = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>';

/** `<head>` tags for search and sharing; also injected into index.html. */
export function headTags({ lang, path, title, description, alternates, ogAlt, jsonLd, ads = ADS }) {
  const t = CHROME[lang];
  const other = lang === 'en' ? 'es' : 'en';
  const links = [
    `<link rel="canonical" href="${abs(path)}">`,
    ...Object.entries(alternates).map(([hl, p]) => `<link rel="alternate" hreflang="${hl}" href="${abs(p)}">`),
    `<link rel="alternate" hreflang="x-default" href="${abs(alternates.en)}">`,
  ];
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    ...links,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Pastty">',
    `<meta property="og:locale" content="${t.locale}">`,
    alternates[other] ? `<meta property="og:locale:alternate" content="${CHROME[other].locale}">` : '',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${abs(path)}">`,
    `<meta property="og:image" content="${abs(OG_IMAGE.path)}">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${esc(ogAlt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${abs(OG_IMAGE.path)}">`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll('<', '\\u003c')}</script>`,
    // Site verification for AdSense: a plain meta tag, so the app page can be
    // verified without loading any ad code.
    ads.client ? `<meta name="google-adsense-account" content="${esc(ads.client)}">` : '',
  ].filter(Boolean).join('\n  ');
}

/** The footer every page shares (the home page gets it injected too). */
export function footer(lang, pages) {
  const t = CHROME[lang];
  const byId = (id) => pages.find((p) => p.lang === lang && p.id === id);
  const item = (id, label) => {
    const p = byId(id);
    return p ? `<li><a href="${p.path}">${esc(label ?? p.nav)}</a></li>` : '';
  };
  const guides = ['text', 'photos', 'iphone', 'android', 'airdrop'].map((id) => item(id)).join('');
  const product = [`<li><a href="/">${esc(t.open)}</a></li>`, item('how'), item('faq'), item('limits')].join('');
  const legal = ['about', 'contact', 'privacy', 'terms', 'cookies'].map((id) => item(id)).join('');
  const en = pages.find((p) => p.lang === 'en' && p.id === 'home');
  const es = pages.find((p) => p.lang === 'es' && p.id === 'home');
  return `<footer class="page-footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <a class="brand" href="${t.home}"><img src="/icon.svg" alt="" width="40" height="40" loading="lazy"><span>Pastty<span class="brand-period">.</span></span></a>
        <p>${esc(t.footerTagline)}</p>
      </div>
      <nav class="footer-col" aria-label="${esc(t.footerGuides)}"><h2>${esc(t.footerGuides)}</h2><ul>${guides}</ul></nav>
      <nav class="footer-col" aria-label="${esc(t.footerProduct)}"><h2>${esc(t.footerProduct)}</h2><ul>${product}</ul></nav>
      <nav class="footer-col" aria-label="${esc(t.footerLegal)}"><h2>${esc(t.footerLegal)}</h2><ul>${legal}</ul></nav>
      <nav class="footer-col" aria-label="${esc(t.footerLanguage)}"><h2>${esc(t.footerLanguage)}</h2><ul><li><a href="${en.path}" hreflang="en" lang="en">English</a></li><li><a href="${es.path}" hreflang="es" lang="es">Español</a></li></ul></nav>
    </div>
  </footer>`;
}

function steps(section) {
  const items = section.items.map((s, i) => `<li><span class="step-num" aria-hidden="true">${i + 1}</span><div><h3>${s.title}</h3><p>${s.text}</p></div></li>`).join('');
  return `<ol class="page-steps">${items}</ol>`;
}

function cards(section) {
  const items = section.items.map((c, i) => `<li data-tone="${c.tone ?? ['pasta', 'apricot', 'butter', 'peach'][i % 4]}"><h3>${c.title}</h3><p>${c.text}</p></li>`).join('');
  return `<ul class="page-cards">${items}</ul>`;
}

function table(section) {
  const head = section.head.map((h) => `<th scope="col">${h}</th>`).join('');
  // Tables wider than two columns stack into one block per row on phones;
  // data-label carries the column name there.
  const wide = section.head.length > 2;
  const cell = (v, i) => (wide ? `<td data-label="${esc(plain(section.head[i + 1]))}">${v}</td>` : `<td>${v}</td>`);
  const rows = section.rows.map(([k, ...rest]) => `<tr><th scope="row">${k}</th>${rest.map(cell).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="page-table${wide ? ' page-table-wide' : ''}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function faq(items) {
  return `<div class="page-faq">${items.map((f) => `<details><summary><h3>${f.q}</h3></summary><div class="faq-answer">${f.a}</div></details>`).join('')}</div>`;
}

function section(s) {
  const id = s.id ? ` id="${s.id}"` : '';
  const body = s.type === 'steps' ? steps(s)
    : s.type === 'cards' ? cards(s)
      : s.type === 'table' ? table(s)
        : s.type === 'faq' ? faq(s.items)
          : '';
  const intro = s.html ? `<div class="prose">${s.html}</div>` : '';
  const after = s.after ? `<div class="prose">${s.after}</div>` : '';
  const cls = s.type === 'callout' ? 'page-section page-callout' : 'page-section';
  const tone = s.tone ? ` data-tone="${s.tone}"` : '';
  return `<section class="${cls}"${id}${tone}><h2>${s.h2}</h2>${intro}${body}${after}</section>`;
}

/**
 * The part of the page that is its own content. Hashed for <lastmod> without
 * `ad` and `updated`, which are not content.
 */
export function mainContent(page, pages, { serving = false, ad = '', updated = '' } = {}) {
  const t = CHROME[page.lang];
  const fig = page.figure
    ? `<figure class="page-figure" data-tone="${page.figure.tone}"><img src="${page.figure.src}" width="${page.figure.width ?? 720}" height="${page.figure.height ?? 720}" alt="${esc(page.figure.alt)}" decoding="async" fetchpriority="high"></figure>`
    : '';
  const crumbs = page.id === 'home' ? '' : `<nav class="breadcrumbs" aria-label="${esc(t.crumbs)}"><ol><li><a href="${t.home}">Pastty</a></li><li aria-current="page">${esc(page.nav)}</li></ol></nav>`;
  const related = (page.related ?? []).map((id) => pages.find((p) => p.lang === page.lang && p.id === id)).filter(Boolean);
  const relatedHtml = related.length
    ? `<section class="page-section"><h2>${esc(t.related)}</h2><ul class="page-related">${related.map((p) => `<li><a href="${p.path}"><span class="related-kicker">${esc(p.kicker)}</span><span class="related-title">${esc(p.nav)}</span>${ARROW}</a></li>`).join('')}</ul></section>`
    : '';
  const body = visible(page.sections, serving).map(section);
  if (ad) {
    // After the first section, and at the end of longer pages: never above the
    // fold, never next to the call to action.
    const n = body.length;
    if (n >= 3) body.push(ad);
    body.splice(Math.min(1, n), 0, ad);
  }
  return `${crumbs}
    <header class="page-hero">
      <div class="hero-copy">
        <h1>${page.h1}</h1>
        <p class="page-lede">${page.lede}</p>
        <div class="page-cta"><a class="btn-primary page-btn" href="/">${esc(t.open)} ${ARROW}</a><span class="cta-note">${esc(t.ctaNote)}</span></div>
      </div>
      ${fig}
    </header>
    ${body.join('\n    ')}${updated ? `\n    ${updated}` : ''}
    ${relatedHtml}
    <section class="page-final" data-tone="pasta">
      <h2>${esc(t.ctaTitle)}</h2>
      <p>${esc(t.ctaText)}</p>
      <a class="btn-primary page-btn" href="/">${esc(t.open)} ${ARROW}</a>
    </section>`;
}

/**
 * The crawlable overview on the home page (generated into index.html between
 * markers): what Pastty is, the guides, real limits and a few answers. It sits
 * below the showcase inside the home view, so rooms never show it.
 */
export function homeAbout(page, pages) {
  const a = page.about;
  const facts = a.facts.map(([k, v]) => `<li><strong>${k}</strong><span>${v}</span></li>`).join('');
  const guides = a.guides.map((id) => {
    const p = pages.find((x) => x.lang === page.lang && x.id === id);
    return `<li><a href="${p.path}"><span class="related-kicker">${esc(p.kicker)}</span><span class="related-title">${esc(p.nav)}</span>${ARROW}</a></li>`;
  }).join('');
  return `<section class="home-about" id="guides" aria-labelledby="about-title">
        <div class="about-head">
          <h2 id="about-title">${a.title}<span class="brand-period">.</span></h2>
          <p>${a.text}</p>
        </div>
        <ul class="about-facts">${facts}</ul>
        <h3 class="about-sub">${esc(a.guidesTitle)}</h3>
        <ul class="page-related">${guides}</ul>
        <h3 class="about-sub">${esc(a.faqTitle)}</h3>
        ${faq(a.faq)}
        <p class="about-more"><a href="${pages.find((x) => x.lang === page.lang && x.id === 'faq').path}">${esc(a.faqMore)}</a></p>
      </section>`;
}

export function jsonLdFor(page, serving = false) {
  const url = abs(page.path);
  const site = { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, name: 'Pastty', url: `${ORIGIN}/` };
  const graph = [
    {
      '@type': page.schemaType ?? 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: page.title,
      description: page.description,
      inLanguage: page.lang,
      isPartOf: { '@id': site['@id'] },
    },
  ];
  if (page.id !== 'home') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Pastty', item: abs(CHROME[page.lang].home) },
        { '@type': 'ListItem', position: 2, name: page.nav, item: url },
      ],
    });
  }
  const faqs = [...visible(page.sections, serving).filter((s) => s.type === 'faq').flatMap((s) => s.items), ...(page.about?.faq ?? [])];
  if (faqs.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faqs.map((f) => ({ '@type': 'Question', name: plain(f.q), acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })),
    });
  }
  if (page.app) graph.push(page.app, site);
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function renderPage(page, pages, { ads = ADS, lastmod } = {}) {
  const t = CHROME[page.lang];
  const mode = adMode(page, ads);
  const updated = page.showUpdated && lastmod
    ? `<p class="page-updated">${esc(t.updated)}: <time datetime="${lastmod}">${longDate(page.lang, lastmod)}</time></p>`
    : '';
  const content = mainContent(page, pages, { serving: mode.serving, ad: mode.slot ? adUnit(page.lang, mode) : '', updated });
  const alternates = Object.fromEntries(pages.filter((p) => p.id === page.id).map((p) => [p.lang, p.path]));
  const other = page.lang === 'en' ? 'es' : 'en';
  const nav = (id, label) => {
    const p = pages.find((x) => x.lang === page.lang && x.id === id);
    const current = p.id === page.id ? ' aria-current="page"' : '';
    return `<a href="${p.path}"${current}>${esc(label)}</a>`;
  };
  return `<!DOCTYPE html>
<html lang="${page.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#f7f2ea">
  ${headTags({ lang: page.lang, path: page.path, title: page.title, description: page.description, alternates, ogAlt: page.ogAlt, jsonLd: jsonLdFor(page, mode.serving), ads })}
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <link rel="preload" href="/fonts/russo-one-400.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="preload" href="/fonts/manrope-400.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/pages.css">${mode.here ? `\n  <script async src="${ADSENSE_SCRIPT}?client=${esc(mode.client)}" crossorigin="anonymous"></script>` : ''}
</head>
<body class="content-page">
  <a class="skip-link" href="#content">${esc(t.skip)}</a>
  <header class="site-header">
    <a class="brand" href="${t.home}" aria-label="Pastty"><img src="/icon.svg" alt="" width="48" height="48"><span>Pastty<span class="brand-period">.</span></span></a>
    <nav class="site-nav" aria-label="${esc(t.nav)}">
      <a class="nav-current" href="/">${esc(t.open)}</a>
      ${nav('how', t.how)}
      ${nav('faq', t.faq)}
    </nav>
    <div class="header-tools">
      ${alternates[other] ? `<a class="lang-switch" href="${alternates[other]}" hreflang="${other}" lang="${other}">${esc(t.langLabel)}</a>` : ''}
      <button class="theme-toggle" id="btn-theme" type="button" aria-label="${esc(t.themeDark)}" data-label-dark="${esc(t.themeDark)}" data-label-light="${esc(t.themeLight)}" aria-pressed="false">${SUN}</button>
    </div>
  </header>
  <main class="page-main" id="content" tabindex="-1">
    ${content}
  </main>
  ${footer(page.lang, pages)}
  <script defer src="/js/design.js"></script>${mode.slot ? '\n  <script defer src="/js/ads.js"></script>' : ''}
</body>
</html>
`;
}
