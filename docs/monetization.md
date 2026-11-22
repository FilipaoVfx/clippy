# Monetization

How pastty.com can carry ads without breaking what Pastty promises, which ad
networks fit, and the switch that turns ads on.

**Status (2026-11-22):** the site is ready to apply to AdSense. No ad code
loads anywhere. `ADS` in `site/config.mjs` is off.

## Research (November 2026)

Checked against each network's own pages where they exist. Third-party claims
are marked.

| Network | What it asks | Fit for Pastty | Verdict |
|---|---|---|---|
| **Google AdSense** | 18+, owner of the site, review of the site and its pages against the [program policies](https://support.google.com/adsense/answer/48182). No published traffic minimum. | Good for the guides. Not allowed on the app: Google bans its ads on [screens without publisher content](https://support.google.com/publisherpolicies/answer/11112688), including screens "used for alerts, navigation or other behavioral purposes". | **Apply first.** Ads on guide pages only. |
| **Adsterra** | Own domain, a site that is not "under construction", human traffic. Fast review. | Its main formats (popunder, interstitial, Social Bar) fire on clicks or cover the page. On Pastty every interaction is a tap on Send or Copy, so they would fire on the core action. | **No.** At most banner or native units on guides, later. |
| **Monetag** | Own domain, ownership check by file or meta tag, real organic traffic. | Same formats as Adsterra plus push. Web push needs a service worker, and Pastty's own `sw.js` already holds the root scope. | **No.** |
| **Media.net** | Approval per site and an `ads.txt` line before serving. Third-party sources (no official page found) say English content and mostly US, UK or Canada traffic, around 5–10k visits a month in practice. | The English guides could qualify once traffic exists. | **Later.** Revisit when Search Console shows that audience. |
| **Ezoic** | Since 19 February 2026, new sites need [250,000 monthly users](https://support.ezoic.com/kb/article/getting-started-ezoics-requirements). Smaller sites go to the Incubator. | Not eligible. | **No.** |

Corrections to common advice:
- "15–30 articles" is a rule of thumb, not an AdSense requirement. Pastty has
  13 pages per language plus the app, and the guides are real how-tos.
- GA4 is not required by any of these networks. Use **Cloudflare Web
  Analytics** (cookieless, no consent banner) plus Search Console for traffic
  numbers.
- **Consent:** to serve ads in the EEA, the UK and Switzerland, AdSense
  [requires a Google-certified CMP](https://support.google.com/adsense/answer/13554116)
  that integrates with the IAB TCF. Google's own Privacy & messaging tool is
  certified and free. Without one, those visitors get limited ads or none.

## Why the clipboard screen never carries ads

1. **Policy:** the room screens are a tool, not content (see above).
2. **Privacy:** any script on a page can read that page. An ad script on `/`
   would be third-party code, chosen at auction time, next to everything people
   paste and receive. Pastty's privacy promise ("nothing you send is ever in
   reach of them") depends on keeping it off.
3. **Experience:** the app runs Three.js and a live socket. Ads would compete
   with both, and with the pairing flow.

`AD_FREE` in `site/config.mjs` names the pages that never load ads: the app
(`/`), the Spanish home, About, Contact, Privacy, Terms and Cookies. The 404
page never does either. Tests enforce this even if `ADS.pages` lists them.

## Where ads go once they are on

- **Pages:** How it works, the five guides, FAQ and Limits, in both languages
  (`ADS.pages`).
- **Placement:** one unit after the first section, and a second at the end of
  pages with three or more sections. Never above the fold, and never next to the
  call to action.
- **Labels and space:** each unit is labelled "Advertisements" or "Anuncios",
  the labels AdSense allows. It reserves 280 px so the page does not jump while
  the ad loads, and hides itself if Google returns no ad.

## What is in place

| Piece | Where |
|---|---|
| About, Contact, Terms and Cookies pages (EN + ES), with Privacy, all in a new footer column | `site/pages/*.mjs` |
| Contact address used by every page | `CONTACT_EMAIL` in `site/config.mjs` |
| Ads switch: publisher id, serve flag, ad unit id, allowed pages | `ADS` in `site/config.mjs` |
| AdSense verification meta tag on every page, the app included (no script) | `headTags` in `site/layout.mjs` |
| `ads.txt` generated from the publisher id | `scripts/build-site.mjs` |
| AdSense loader and units, only on allowed pages | `renderPage` in `site/layout.mjs`, `public/js/ads.js` |
| Privacy, Cookies, Terms and About text that follows the mode. Sections marked `ads: 'on'` or `ads: 'off'` render only in that mode, so the pages never claim "no ads" while ads run or describe ads that do not exist. | `site/pages/*.mjs` |
| "Last updated" date on Privacy, Terms and Cookies, taken from the same content hash as the sitemap's `lastmod` | `showUpdated` |
| Tests for all of the above, in both modes | `tests/site/site.test.js` |

The home page's "No plans, no ads, no account" now reads "No plans, no
sign-up", which stays true either way.

## Turning ads on

1. **Before applying**
   - Make sure the contact address delivers mail (see the owner steps below).
   - Deploy, and submit the sitemap in Search Console (see `docs/seo.md`).
   - A few weeks of organic traffic makes approval and any revenue more
     likely. Do not buy or exchange traffic.
2. **Apply**
   - Add `pastty.com` in AdSense and choose **Meta tag** as the verification
     method.
   - Put the publisher id in `ADS.client` (`ca-pub-` and 16 digits), then run
     `npm run site:build` and deploy.
   - This adds the meta tag and `/ads.txt` (`google.com, pub-…, DIRECT,
     f08c47fec0942fa0`). No ad loads yet.
   - Click **Verify**, then **Request review**.
3. **Wait for approval.** Do not add ad code before it.
4. **After approval**
   - **Consent message.** In AdSense, open **Privacy & messaging** and publish
     a European regulations message for pastty.com.
   - **Ad unit.** Create one responsive display ad unit and put its id in
     `ADS.slot`.
   - **Auto ads.** Leave them off for pastty.com. If you turn them on, disable
     vignette and anchor ads: a vignette would fire as people go from a guide
     to the app.
   - **Lock the app page.** Give the app page a Content Security Policy that
     only runs Pastty's own scripts:
     1. Move the inline service-worker registration at the end of
        `public/index.html` into a file such as `public/js/sw-register.js`.
     2. Add this to `public/_headers`:
        ```
        /
          Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri 'self'
        ```
     3. Test on a Pages preview before production.
   - **Switch on.** Set `ADS.serve = true`, run `npm run site:build` and
     `npm test`, then deploy.
5. **Afterwards**
   - Watch AdSense's Policy center and Sites pages.
   - Watch Core Web Vitals in Search Console.
   - Watch RPM per page. Drop units that slow pages without paying.

## Rules that end accounts

- Never click your own ads, and never ask anyone to click them.
- Never buy, exchange or incentivise traffic.
- Never place ads near buttons, where they invite accidental clicks.
- Never edit the ad code.
- Never put ads on pages the network has not approved.

## Owner steps (not doable from the repo)

1. **Contact address**
   - `pastty.com`'s MX records point at Namecheap email forwarding
     (`eforward*.registrar-servers.com`), while its DNS is on Cloudflare.
   - Send a test to `hello@pastty.com`. If it does not arrive, set up
     Cloudflare **Email › Email Routing** for the domain (it replaces those MX
     records) and forward `hello@` to your inbox.
   - To use another address, change `CONTACT_EMAIL` and rebuild.
2. **Terms.** They do not name an operator or a governing law. Add them if your
   country requires it.
3. **AdSense account.** Account holder 18+, plus payment and tax details.
4. **Traffic numbers.** Turn on Cloudflare Web Analytics for the Pages project
   (Workers & Pages › clippy › Metrics).
