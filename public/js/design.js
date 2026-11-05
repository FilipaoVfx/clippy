// Presentation preferences are independent of the pairing/session protocol.
(() => {
  const themeButton = document.getElementById('btn-theme');
  const helpButton = document.getElementById('btn-help');
  const help = document.getElementById('how-it-works');

  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#22201e' : '#f4ece5';
  }

  let savedTheme;
  try { savedTheme = localStorage.getItem('pastty_theme'); } catch { /* unavailable in private mode */ }
  setTheme(savedTheme === 'dark');
  themeButton.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    setTheme(dark);
    try { localStorage.setItem('pastty_theme', dark ? 'dark' : 'light'); } catch { /* optional preference */ }
  });

  helpButton.addEventListener('click', () => {
    help.hidden = !help.hidden;
    helpButton.setAttribute('aria-expanded', String(!help.hidden));
    if (!help.hidden) help.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  });
})();
