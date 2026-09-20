// Decode the incoming photo before sliding. While a transition runs, retain only
// the latest requested photo so fast clicks and slow downloads cannot go stale.
export function slidingPhoto(image, error) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let ticket = 0, running = Promise.resolve(), animations = [], outgoing;
  function finish() { animations.forEach(animation => animation.finish()); }
  motion.addEventListener('change', () => { if (motion.matches) finish(); });
  function clear() {
    ticket++; animations.forEach(animation => animation.cancel()); animations = [];
    outgoing?.remove(); outgoing = null;
  }
  async function show(url, alt, { direction = 1, animate = true } = {}) {
    const request = ++ticket;
    if (image.getAttribute('src') === url && !image.hidden) { image.alt = alt; return; }
    const incoming = new Image(); incoming.src = url;
    try { await incoming.decode(); }
    catch {
      if (request === ticket) { await running; if (request === ticket) { image.hidden = true; error.hidden = false; } }
      return;
    }
    await running;
    if (request !== ticket || !image.isConnected) return;
    const canAnimate = animate && !motion.matches && !image.hidden && image.hasAttribute('src') && typeof image.animate === 'function';
    if (canAnimate) {
      outgoing = image.cloneNode();
      outgoing.removeAttribute('data-cart-featured'); outgoing.removeAttribute('data-cart-light-image');
      outgoing.removeAttribute('id'); outgoing.alt = ''; outgoing.setAttribute('aria-hidden', 'true');
      outgoing.className = 'cart-photo-outgoing'; image.parentElement.append(outgoing);
    }
    image.src = url; image.alt = alt; image.hidden = false; error.hidden = true;
    if (!canAnimate) return;
    const previous = outgoing, sign = direction < 0 ? -1 : 1;
    const timing = { duration: 600, easing: 'ease-in-out' };
    animations = [
      image.animate([{ transform: `translateX(${sign * 100}%)` }, { transform: 'translateX(0)' }], timing),
      previous.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-sign * 100}%)` }], timing),
    ];
    const current = animations;
    running = Promise.all(current.map(animation => animation.finished.catch(() => {}))).then(() => {
      previous.remove(); if (outgoing === previous) outgoing = null;
      if (animations === current) animations = [];
    });
    await running;
  }
  return { show, clear };
}
