// Fills the AdSense units on guide pages. Only pages with ads enabled load this
// file (see ADS in site/config.mjs); the app page never does.
for (let i = document.querySelectorAll('ins.adsbygoogle').length; i > 0; i -= 1) {
  (window.adsbygoogle = window.adsbygoogle || []).push({});
}
