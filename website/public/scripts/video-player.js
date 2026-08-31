const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const videos = [...document.querySelectorAll('[data-autoplay-when-visible]')];

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const video = entry.target;

      if (reducedMotion.matches || !entry.isIntersecting) {
        video.pause();
        continue;
      }

      void video.play().catch(() => {
        // Native controls remain available when a browser blocks autoplay.
      });
    }
  },
  { threshold: 0.35 },
);

for (const video of videos) {
  observer.observe(video);
}

reducedMotion.addEventListener('change', () => {
  for (const video of videos) {
    if (reducedMotion.matches) {
      video.pause();
    }
  }
});
