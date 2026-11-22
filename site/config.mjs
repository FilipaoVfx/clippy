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
    footerLanguage: 'Language',
    faqTitle: 'Questions',
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
    footerLanguage: 'Idioma',
    faqTitle: 'Preguntas',
  },
};
