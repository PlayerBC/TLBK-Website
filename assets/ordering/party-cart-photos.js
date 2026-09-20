import { config } from './config.js';
import { packageEscape as esc } from './party-packages-view.js';
import { startIdleSlideshow } from './party-cart-slideshow.js';

const root = document.querySelector('[data-cart-gallery]');
if (root) {
  let items = [], index = 0, lightIndex = 0, returnFocus;
  const $ = selector => root.querySelector(selector);
  const status = $('[data-cart-gallery-status]'), viewer = $('[data-cart-viewer]'), image = $('[data-cart-featured]');
  const dialog = $('[data-cart-lightbox]');
  const caption = i => items[i]?.caption || `Party cart photo ${i + 1}`;
  const cyclic = n => (n + items.length) % items.length;
  const slideshow = startIdleSlideshow(root, { next: () => show(index + 1), count: () => items.length });
  function revealThumb(container, button) {
    // Scroll only the thumbnail strip, never the page during automatic playback.
    if (!button) return;
    const left = button.offsetLeft - container.offsetLeft;
    if (left < container.scrollLeft) container.scrollLeft = left;
    else if (left + button.offsetWidth > container.scrollLeft + container.clientWidth) container.scrollLeft = left + button.offsetWidth - container.clientWidth;
  }
  function show(next) {
    if (!items.length) return;
    index = cyclic(next); image.hidden = false; $('[data-cart-image-error]').hidden = true;
    image.src = items[index].photo_url; image.alt = caption(index);
    $('[data-cart-count]').textContent = `${index + 1} / ${items.length}`;
    $('[data-cart-caption]').textContent = items[index].caption;
    root.querySelectorAll('[data-cart-thumb]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.cartThumb) === index)));
    revealThumb($('[data-cart-thumbs]'), $(`[data-cart-thumb="${index}"]`));
  }
  image.addEventListener('error', () => { image.hidden = true; $('[data-cart-image-error]').hidden = false; });
  function light(next) {
    lightIndex = cyclic(next);
    const img = $('[data-cart-light-image]'); img.hidden = false; $('[data-cart-light-error]').hidden = true;
    img.src = items[lightIndex].photo_url; img.alt = caption(lightIndex);
    $('[data-cart-light-caption]').textContent = `${caption(lightIndex)} · ${lightIndex + 1} / ${items.length}`;
    root.querySelectorAll('[data-cart-light-thumb]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.cartLightThumb) === lightIndex)));
    revealThumb($('[data-cart-light-thumbs]'), $(`[data-cart-light-thumb="${lightIndex}"]`));
  }
  $('[data-cart-light-image]').addEventListener('error', event => { event.target.hidden = true; $('[data-cart-light-error]').hidden = false; });
  function open() {
    if (!items.length) return;
    returnFocus = document.activeElement; slideshow.suspend(true); dialog.showModal(); light(index); $('[data-cart-light-close]').focus();
  }
  dialog.addEventListener('close', () => { returnFocus?.focus({ preventScroll: true }); slideshow.suspend(false); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); light(lightIndex + (event.key === 'ArrowRight' ? 1 : -1)); }
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-cart-gallery-retry')) { void load(); return; }
    if (!items.length) return;
    if (button.hasAttribute('data-cart-open')) open();
    if (button.hasAttribute('data-cart-step')) show(index + Number(button.dataset.cartStep));
    if (button.hasAttribute('data-cart-thumb')) show(Number(button.dataset.cartThumb));
    if (button.hasAttribute('data-cart-light-close')) dialog.close();
    if (button.hasAttribute('data-cart-light-step')) light(lightIndex + Number(button.dataset.cartLightStep));
    if (button.hasAttribute('data-cart-light-thumb')) light(Number(button.dataset.cartLightThumb));
    slideshow.restart();
  });
  async function load() {
    $('[data-cart-gallery-retry]').hidden = true; viewer.hidden = true; items = [];
    status.textContent = 'Loading party cart photos…'; slideshow.restart();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/party_cart_photos_api`, {
        method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_action: 'browse', p_payload: {} }), signal: controller.signal,
      });
      if (!response.ok) throw new Error('Photos unavailable');
      items = (await response.json()).items;
      status.textContent = items.length ? '' : 'More celebration photos coming soon. Explore our packages below.';
      if (!items.length) return;
      const thumbs = (attribute) => items.map((p, i) => `<button type="button" ${attribute}="${i}" aria-label="View ${esc(caption(i))}" aria-pressed="${i === 0}"><img src="${esc(p.photo_url)}" alt="" loading="lazy" decoding="async"></button>`).join('');
      $('[data-cart-thumbs]').innerHTML = thumbs('data-cart-thumb');
      $('[data-cart-light-thumbs]').innerHTML = thumbs('data-cart-light-thumb');
      root.querySelectorAll('[data-cart-step],[data-cart-light-step],[data-slideshow-toggle]').forEach(b => { b.hidden = items.length < 2; });
      $('[data-cart-open-all]').textContent = `View all ${items.length} photos ↗`;
      viewer.hidden = false; show(0); slideshow.restart();
    } catch {
      status.textContent = 'Party cart photos could not load. Please try again.'; $('[data-cart-gallery-retry]').hidden = false;
    } finally { clearTimeout(timeout); }
  }
  void load();
}
