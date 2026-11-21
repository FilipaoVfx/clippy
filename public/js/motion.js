// Motion showcase: pre-rendered clips (see motion/), never the Remotion runtime.
// Clips load only when scrolled near, play only while visible, and stay on
// their poster frame for reduced-motion or data-saver users unless asked.
// Clips are short; each rests on its last frame for data-rest ms, then replays.
(() => {
  const videos = [...document.querySelectorAll('video[data-motion]')];
  const toggle = document.querySelector('[data-motion-toggle]');
  if (!videos.length) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  let paused = reduce.matches || saveData;
  const visible = new Set();

  function load(video) {
    if (video.dataset.loaded) return;
    video.dataset.loaded = '1';
    for (const source of video.querySelectorAll('source[data-src]')) source.src = source.dataset.src;
    video.load();
  }

  function sync() {
    for (const video of videos) {
      if (!paused && visible.has(video)) {
        load(video);
        if (video.ended) video.currentTime = 0;
        video.play().catch(() => { /* autoplay refused: the poster stays */ });
      } else if (!video.paused) {
        video.pause();
      }
    }
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.setAttribute('aria-label', paused ? 'Play animations' : 'Pause animations');
    }
  }

  if (!('IntersectionObserver' in window)) {
    videos.forEach((v) => visible.add(v));
    sync();
  } else {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      sync();
    }, {threshold: [0, 0.35, 0.6]});
    videos.forEach((v) => observer.observe(v));
  }

  for (const video of videos) {
    let rest = 0;
    video.addEventListener('ended', () => {
      clearTimeout(rest);
      rest = setTimeout(() => {
        // Resume whatever state it is in now; restart only if still at the end.
        if (video.paused && !paused && visible.has(video) && !document.hidden) {
          if (video.ended) video.currentTime = 0;
          video.play().catch(() => {});
        }
      }, Number(video.dataset.rest) || 1000);
    });
  }

  toggle?.addEventListener('click', () => {
    paused = !paused;
    sync();
  });
  reduce.addEventListener?.('change', (event) => {
    paused = event.matches;
    sync();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) videos.forEach((v) => v.pause());
    else sync();
  });
})();
