// A timer is scheduled only while the gallery is visible and idle. Each manual
// interaction gets a fresh interval; background tabs never accumulate slides.
export function startIdleSlideshow(root, { next, count, interval = 3000 }) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motion.matches, visible = true, suspended = false, timer;
  const button = root.querySelector('[data-slideshow-toggle]');
  function eligible() { return !paused && !document.hidden && visible && !suspended && count() > 1 && root.isConnected; }
  function schedule() {
    clearTimeout(timer);
    if (eligible()) timer = setTimeout(() => { if (eligible()) next(); schedule(); }, interval);
  }
  function paint() { button.textContent = paused ? 'Play slideshow' : 'Pause slideshow'; button.setAttribute('aria-label', button.textContent); }
  button.addEventListener('click', () => { paused = !paused; paint(); schedule(); });
  // Focus and a resting pointer must not permanently pause playback after an
  // arrow/thumbnail click. Activity restarts the idle delay instead.
  for (const name of ['pointerenter','pointerleave','focusin','focusout']) root.addEventListener(name, schedule);
  for (const name of ['pointerdown','pointermove','keydown','scroll','touchstart']) document.addEventListener(name, schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', () => { suspended = true; schedule(); });
  window.addEventListener('pageshow', () => { suspended = false; schedule(); });
  motion.addEventListener('change', () => { paused = motion.matches; paint(); schedule(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; schedule(); }, { threshold: 0.1 }).observe(root);
  paint(); schedule();
  return { restart: schedule, suspend(value) { suspended = value; schedule(); } };
}
