// Shared facts for the content pages and the sitemap. Limits are read from
// wrangler.toml, the production config, so the pages can never promise more
// than the relay accepts.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = resolve(ROOT, 'public');
export const ORIGIN = 'https://pastty.com';
export const OG_IMAGE = { path: '/assets/og-pastty.jpg', width: 1200, height: 630 };

/** Where people reach the owner (Contact, Terms, Privacy). Must deliver mail. */
export const CONTACT_EMAIL = 'hello@pastty.com';

/**
 * Advertising (Google AdSense), off until the owner flips it. See
 * docs/monetization.md for the whole sequence.
 *
 * 1. client: the publisher ID AdSense shows ("ca-pub-" + 16 digits). Adds the
 *    site-verification meta tag and /ads.txt. No ad code loads yet.
 * 2. serve: true only after AdSense approves the site. The pages listed in
 *    `pages` load AdSense; Privacy, Cookies and About switch to the copy that
 *    describes ads.
 * 3. slot: the id of one responsive display unit (data-ad-slot). With it, those
 *    pages get up to two marked units between sections.
 *
 * The app page (/) never loads ads: AdSense does not allow them on screens
 * without publisher content, and a third-party script there could read what
 * people paste. Legal pages, the Spanish home page and the 404 stay ad-free too.
 */
export const ADS = Object.freeze({
  client: null,
  serve: false,
  slot: null,
  pages: Object.freeze(['how', 'text', 'photos', 'iphone', 'android', 'airdrop', 'faq', 'limits']),
});

/** Page ids that may never carry ads, whatever ADS.pages says. */
export const AD_FREE = Object.freeze(['home', 'privacy', 'terms', 'cookies', 'contact', 'about']);

function readVars() {
  const toml = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  const section = toml.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
  const vars = {};
  for (const [, key, value] of section.matchAll(/^([A-Z_]+)\s*=\s*"?(\d+)"?\s*$/gm)) vars[key] = Number(value);
  return vars;
}

function bytes(n) {
  return n >= 1048576 ? `${Math.round(n / 1048576)} MB` : `${Math.round(n / 1024)} KB`;
}

const vars = readVars();
const need = (key) => {
  if (!Number.isFinite(vars[key])) throw new Error(`wrangler.toml [vars] is missing ${key}`);
  return vars[key];
};

/** Human-readable limits, straight from the production config. */
export const LIMITS = Object.freeze({
  text: bytes(need('MAX_MESSAGE_SIZE')),
  image: bytes(need('IMAGE_MAX_BYTES')),
  video: bytes(need('VIDEO_MAX_BYTES')),
  devices: need('MAX_DEVICES'),
  codeMinutes: Math.round(need('SESSION_TTL_MS') / 60000),
  rejoinSeconds: Math.round(need('DEVICE_DISCONNECT_TTL_MS') / 1000),
  messagesPerMinute: Math.round(need('RATE_LIMIT_MAX') * 60000 / need('RATE_LIMIT_WINDOW_MS')),
  bytesPerMinute: bytes(need('RATE_LIMIT_BYTES') * 60000 / need('RATE_LIMIT_WINDOW_MS')),
});

/** Interface strings shared by every page, per language. */
export const CHROME = {
  en: {
    locale: 'en_US',
    home: '/',
    skip: 'Skip to content',
    nav: 'Main navigation',
    open: 'Open Pastty',
    how: 'How it works',
    faq: 'FAQ',
    themeDark: 'Use dark theme',
    themeLight: 'Use light theme',
    langLabel: 'Leer en español',
    crumbs: 'Breadcrumb',
    ctaNote: 'Free · No app · No account',
    ctaTitle: 'Share something in a few seconds.',
    ctaText: 'Open Pastty on two devices, pair them with the code, and send.',
    related: 'Keep reading',
    footerTagline: 'Less sending to yourself. More getting on with it.',
    footerGuides: 'Guides',
    footerProduct: 'Pastty',
    footerLegal: 'About & legal',
    footerLanguage: 'Language',
    faqTitle: 'Questions',
    adLabel: 'Advertisements',
    updated: 'Last updated',
  },
  es: {
    locale: 'es_LA',
    home: '/es/',
    skip: 'Saltar al contenido',
    nav: 'Navegación principal',
    open: 'Abrir Pastty',
    how: 'Cómo funciona',
    faq: 'Preguntas',
    themeDark: 'Usar tema oscuro',
    themeLight: 'Usar tema claro',
    langLabel: 'Read in English',
    crumbs: 'Ruta de navegación',
    ctaNote: 'Gratis · Sin apps · Sin cuenta',
    ctaTitle: 'Comparte algo en unos segundos.',
    ctaText: 'Abre Pastty en dos dispositivos, conéctalos con el código y envía.',
    related: 'Sigue leyendo',
    footerTagline: 'Menos mandarte cosas a ti mismo. Más seguir con lo tuyo.',
    footerGuides: 'Guías',
    footerProduct: 'Pastty',
    footerLegal: 'Acerca y legal',
    footerLanguage: 'Idioma',
    faqTitle: 'Preguntas',
    adLabel: 'Anuncios',
    updated: 'Última actualización',
  },
};
