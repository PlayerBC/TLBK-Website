// A timer is scheduled only while the gallery is visible and idle. Each manual
// interaction gets a fresh interval; background tabs never accumulate slides.
export function startIdleSlideshow(root, { next, count, interval = 4000 }) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motion.matches, hovered = false, focused = false, visible = true, suspended = false, explicitPlay = false, timer;
  const button = root.querySelector('[data-slideshow-toggle]');
  function eligible() { return !paused && (explicitPlay || (!hovered && !focused)) && !document.hidden && visible && !suspended && count() > 1 && root.isConnected; }
  function schedule() {
    clearTimeout(timer);
    if (eligible()) timer = setTimeout(() => { if (eligible()) next(); schedule(); }, interval);
  }
  function paint() { button.textContent = paused ? 'Play slideshow' : 'Pause slideshow'; button.setAttribute('aria-label', button.textContent); }
  button.addEventListener('click', () => { paused = !paused; explicitPlay = !paused; paint(); schedule(); });
  root.addEventListener('pointerdown', event => { if (!event.target.closest('[data-slideshow-toggle]')) explicitPlay = false; });
  root.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovered = true; schedule(); } });
  root.addEventListener('pointerleave', () => { hovered = false; schedule(); });
  root.addEventListener('focusin', event => { focused = true; if (event.target !== button) explicitPlay = false; schedule(); });
  root.addEventListener('focusout', () => { queueMicrotask(() => { focused = root.contains(document.activeElement); schedule(); }); });
  for (const name of ['pointerdown','pointermove','keydown','scroll','touchstart']) document.addEventListener(name, schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', () => { suspended = true; schedule(); });
  window.addEventListener('pageshow', () => { suspended = false; schedule(); });
  motion.addEventListener('change', () => { paused = motion.matches; paint(); schedule(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; schedule(); }, { threshold: 0.1 }).observe(root);
  paint(); schedule();
  return { restart: schedule, suspend(value) { suspended = value; schedule(); } };
}
