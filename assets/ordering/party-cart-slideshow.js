// A timer is scheduled only while the gallery is visible and idle. Each manual
// interaction gets a fresh interval; background tabs never accumulate slides.
export function startIdleSlideshow(root, { next, count, interval = 3000 }) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = true, suspended = false, timer;
  function eligible() { return !motion.matches && !document.hidden && visible && !suspended && count() > 1 && root.isConnected; }
  function schedule() {
    clearTimeout(timer);
    if (eligible()) timer = setTimeout(() => { if (eligible()) next(); schedule(); }, interval);
  }
  // Focus and a resting pointer must not permanently pause playback after an
  // arrow/thumbnail click. Activity restarts the idle delay instead.
  for (const name of ['pointerenter','pointerleave','focusin','focusout']) root.addEventListener(name, schedule);
  for (const name of ['pointerdown','pointermove','keydown','scroll','touchstart']) document.addEventListener(name, schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', () => { suspended = true; schedule(); });
  window.addEventListener('pageshow', () => { suspended = false; schedule(); });
  motion.addEventListener('change', schedule);
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; schedule(); }, { threshold: 0.1 }).observe(root);
  schedule();
  return { restart: schedule, suspend(value) { suspended = value; schedule(); } };
}
