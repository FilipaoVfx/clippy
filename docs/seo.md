# SEO

How pastty.com is set up for search, why, and how to keep it right.

## Research (November 2026)

Competitors checked: clipsync.live (main reference), clipcroft.com,
snapdrop.net, sharedrop.io, send-anywhere.com, pairdrop.net, cl1p.net,
copypaste.me, justpaste.it, wormhole.app and dontpad.com.

**clipsync.live** is the closest product: rooms joined with a code, text,
images and files, no account. Its setup:

| Area | clipsync.live |
|---|---|
| Home | A landing page of about 900 words. The app lives at `/app`, which robots.txt blocks |
| Title | "Free Online Clipboard – Copy & Paste Between Devices \| ClipSync" |
| H1 | "Copy & Paste Between Devices Instantly" |
| Pages in the sitemap | 9: home, about, faq, pricing, limits, privacy, terms, `copy-text-from-phone-to-computer`, `transfer-files-from-phone-to-computer` |
| Guide template | H1 → 3 steps → 3 benefits → platforms → FAQ → link to the sibling guide → CTA (450–650 words) |
| Structured data | Organization and WebApplication on the home page; FAQPage on the FAQ and guides |
| Sharing | `og:image` is the favicon, so shared links show a small square instead of a card |
| Technical | Real 404s, www → apex 301, a `Sitemap:` line in robots.txt, sitemap without `lastmod` |
| Language | English only |

What the rest showed:
- **Clipcroft** has about 30 pages: one per use case (`transfer-iphone-to-windows`,
  `airdrop-alternative-for-windows`), comparisons and an `/es` version.
- **Snapdrop and ShareDrop** have about 70 URLs each across about 10 languages,
  with `hreflang` and an FAQ.
- **The older tools** (cl1p, PairDrop, Wormhole and others) have no sitemap and
  rely on their brand.

### Where Pastty was before this work

- `/robots.txt` and `/sitemap.xml` returned the app's HTML with a 200.
- Every unknown URL returned the app with a 200, a soft 404.
- `www.pastty.com` showed a third-party domain-parking page over HTTP and a
  Cloudflare 525 error over HTTPS.
- No canonical, Open Graph or structured data, and a title that did not say
  what the product does.
- One indexable page.

## What is in place

| Piece | Where |
|---|---|
| robots.txt (allows everything, declares the sitemap) | `public/robots.txt` |
| sitemap.xml with `hreflang` alternates and an honest `lastmod` | generated |
| 9 English and 10 Spanish content pages, and the Spanish home page `/es/` | generated from `site/pages/*.mjs` |
| Home page `<head>` (title, canonical, hreflang, Open Graph, JSON-LD) plus an overview section and footer | generated between markers in `public/index.html` |
| 404 page (`noindex`) | generated `public/404.html` |
| Real 404s, `www` → apex 301, stray `?code=` links → `/?code=` | `cloudflare/worker.js`, mirrored in `server/index.js` |
| Social card 1200×630 | `public/assets/og-pastty.jpg` (`cd motion && npm run render:stills`) |

The site beats clipsync.live on some points:
- a real social card;
- Spanish pages with `hreflang`;
- guides for iPhone↔Windows, Android↔PC and an AirDrop alternative;
- `lastmod` dates that are true;
- limits pulled from the production config.

Structured data:
- Every page has a WebPage block.
- Guides also have a BreadcrumbList.
- Pages that show questions also have an FAQPage.
- The home page also has WebApplication (free offer) and WebSite.

Since 2023, Google shows FAQ rich results only for government and health
sites, so FAQPage here is for meaning, not for a rich result. Nothing on the
site claims ratings or reviews.

### Content rules

The pages may only claim what the code does:
- Content is relayed to the devices connected at that moment and **never
  stored**.
- Pastty does **not** read the system clipboard by itself.
- Traffic is encrypted **in transit** (HTTPS/WSS). It is **not** end-to-end
  encrypted.
- Formats: PNG/JPG/WEBP images and MP4/WEBM/MOV video. Other file types are not
  supported.
- The limits (text, image and video sizes, devices, room time, reconnect
  window, rate) are read from `wrangler.toml [vars]` by `site/config.mjs`, so a
  change there flows into every page on the next `npm run site:build`.

`tests/site/site.test.js` enforces part of this. It also checks:
- titles are 60 characters or fewer, and descriptions are 110–160 characters;
- titles and descriptions are unique;
- each page has one H1, a self-canonical and reciprocal hreflang;
- JSON-LD parses, and every internal link resolves;
- the sitemap covers every page;
- the generated files are committed up to date.

## Hosting: who answers pastty.com

`pastty.com` is served by a **Cloudflare Pages** project connected to this repo
(see `cloudflare/DEPLOY.md`). It publishes `public/` as is, and zone routes
send only `/ws` and `/health` to the `clippy-realtime` Worker. So in production:

- Pages strips `.html` (`/faq.html` → 308 → `/faq`), adds the trailing slash
  for `/es/`, and serves the top-level `404.html` with a 404 for unknown paths.
  The soft 404s came from Pages' single-page-app fallback, which turns off
  automatically once `404.html` exists.
- `public/_headers` sends `X-Robots-Tag: noindex` on the `*.pages.dev` mirrors.
- The routing in `cloudflare/worker.js` (404 page, `www` redirect, `?code=`
  on other paths, `noindex` on `workers.dev`) applies wherever the Worker
  serves the site: its `workers.dev` URL, local `wrangler dev`, or the domain
  if it is ever moved to the Worker.
- Pages serves `public/sw.js` without the build step, so its `BUILD_ID` stays
  `__BUILD_ID__`. This predates the SEO work. Setting the Pages build command to
  `npm run build` with output `dist` would give each deploy its own cache name.

## Sitemap and `lastmod`

- Google ignores `changefreq` and `priority`, so the sitemap leaves them out.
- Google uses `lastmod` only when it proves accurate, so it must not change on
  every deploy.
- `scripts/build-site.mjs` hashes each page's own content (not the shared
  header and footer) and stores the hash with the date in `site/lastmod.json`.
  The date moves only when that hash changes.
- The sitemap ping endpoint is gone (2023). Submit the sitemap in Search Console
  and keep the `Sitemap:` line in robots.txt.

## Workflow

```bash
npm run site:build              # after editing site/ or the generated blocks' sources
npm test                        # fails if public/ is stale or a rule above breaks
npm run seo:check -- http://localhost:3000     # crawl a running server
npm run seo:check -- https://pastty.com        # after deploying (also checks www)
```

To add a page:
1. Add an entry to `site/pages/en.mjs` and its translation, with the same `id`,
   to `site/pages/es.mjs`.
2. Link it from `related` lists or from the footer list in `site/layout.mjs`.
3. Run `npm run site:build`.

## Owner steps (not doable from the repo)

1. **Fix `www` in Cloudflare.** `www.pastty.com` still points at a parking page
   (a 525 over HTTPS).
   - In DNS for pastty.com, delete that `www` record.
   - Add a proxied `AAAA www 100::` record.
   - In **Rules › Redirect Rules**, create a single redirect: when the hostname
     equals `www.pastty.com`, send a 301 to the dynamic target
     `concat("https://pastty.com", http.request.uri.path)` and preserve the
     query string.
   - Do not add `www` as a Pages custom domain: that would serve a duplicate
     copy instead of redirecting.
   - Verify with `npm run seo:check -- https://pastty.com`.
2. **Google Search Console.**
   - Add a domain property for `pastty.com` (DNS TXT verification in
     Cloudflare).
   - Submit `https://pastty.com/sitemap.xml`.
   - Use URL Inspection on `/` and two guides to request indexing.
3. **Leave Cloudflare's "managed robots.txt" off** (Security › Bots / AI Crawl
   Control) unless you mean it. On the preview tunnel's zone it prepends rules
   that block Applebot, which feeds Apple's search, and AI search crawlers
   (OAI-SearchBot, PerplexityBot, Claude-SearchBot). `seo:check` reads only the
   `User-agent: *` groups, so it would not flag this.
4. **Bing Webmaster Tools.** Import the property from Search Console and submit
   the same sitemap.
