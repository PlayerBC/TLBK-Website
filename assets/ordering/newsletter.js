// Capture and remove private newsletter link data before importing auth or
// making any request. A page view never confirms or cancels a subscription.
const landing = document.getElementById('newsletter-root');
let linkAction = '', linkToken = '';
function captureLink() {
  if (!landing) return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  linkAction = ''; linkToken = '';
  if (fragment.has('confirm')) { linkAction = 'confirm'; linkToken = fragment.get('confirm'); }
  else if (fragment.has('unsubscribe')) { linkAction = 'unsubscribe'; linkToken = fragment.get('unsubscribe'); }
  else if (['confirm', 'unsubscribe'].includes(fragment.get('action'))) { linkAction = fragment.get('action'); linkToken = fragment.get('token') || ''; }
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
}
captureLink();

// Stable keys deliberately have no version or expiry: a popup is shown at most
// once in this browser. Signed-in visitors also have a server-side seen record.
const shownKey = 'tlb-newsletter-popup-shown';
const preferenceKey = 'tlb-newsletter-preference';
let shownInMemory = false;
let preferenceInMemory = '';
let servicePromise;
const service = () => servicePromise ||= import('./newsletter-client.js');
const request = async (action, payload) => (await service()).newsletterRequest(action, payload);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));

function readLocal(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeLocal(key, value) { try { localStorage.setItem(key, value); } catch { /* Account popup history is retained on the server when local storage is unavailable. */ } }
const seenHere = () => shownInMemory || readLocal(shownKey) === 'true';
function markShown(requirePersistent = false) {
  if (requirePersistent) {
    // A guest has no server identity. If this browser cannot retain the actual
    // seen flag, skip the invitation rather than repeat it on every page load.
    try { localStorage.setItem(shownKey, 'true'); if (localStorage.getItem(shownKey) !== 'true') return false; }
    catch { return false; }
  } else writeLocal(shownKey, 'true');
  shownInMemory = true;
  return true;
}
function rememberPreference(status) {
  preferenceInMemory = status;
  writeLocal(preferenceKey, status);
  document.dispatchEvent(new CustomEvent('tlb-newsletter-preference', { detail: { status } }));
}
const subscribedHere = () => ['pending', 'subscribed'].includes(preferenceInMemory || readLocal(preferenceKey));
function status(node, message, error = false) {
  node.hidden = false;
  node.dataset.error = String(error);
  node.textContent = message;
}

function formMarkup(source, id, email = '') {
  return `<form class="newsletter-form" data-newsletter-form data-source="${source}">
    <label class="newsletter-field" for="${id}-email">Email address<input id="${id}-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${escape(email)}" required></label>
    <div class="newsletter-trap" aria-hidden="true"><label>Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
    <button class="newsletter-button" type="submit">Subscribe & get 5% off</button><dl class="newsletter-offer-terms" aria-label="Welcome discount terms"><div><dt>From signup</dt><dd>30 days</dd></div><div><dt>Minimum products</dt><dd>₱300</dd></div><div><dt>Maximum discount</dt><dd>₱100</dd></div><div><dt>Per subscriber</dt><dd>One use</dd></div></dl><p class="newsletter-fine newsletter-offer-note">Delivery fees excluded. Sign in with the same email. One promo code per order.</p>
    <p class="newsletter-fine">By subscribing, you agree to receive occasional TLB emails about new treats, seasonal menus, and special offers. Unsubscribe anytime.</p>
    <p class="newsletter-status" data-newsletter-status role="status" hidden></p>
  </form>`;
}

export function mountNewsletterForms(scope = document) {
  scope.querySelectorAll('[data-newsletter-form]').forEach(form => {
    if (form.dataset.mounted) return;
    form.dataset.mounted = 'true';
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (form.dataset.busy || !form.reportValidity()) return;
      const button = form.querySelector('button[type=submit]');
      const message = form.querySelector('[data-newsletter-status]');
      const values = new FormData(form);
      form.dataset.busy = 'true'; button.disabled = true;
      const label = button.textContent; button.textContent = 'Subscribing…';
      try {
        await request('subscribe', { email: String(values.get('email') || '').trim(), source: form.dataset.source || 'homepage', website: String(values.get('website') || '') });
        rememberPreference('subscribed');
        const dialog = form.closest('#newsletter-dialog');
        if (dialog) {
          dialog.querySelector('#newsletter-popup-title').textContent = 'You’re in!';
          const copy = dialog.querySelector('#newsletter-popup-copy');
          copy.setAttribute('role', 'status');
          copy.textContent = 'Welcome to the TLB newsletter! New subscribers will receive their personal 5% off code in the welcome email. Stay tuned for more subscriber-only discounts.';
          form.remove();
          dialog.querySelector('.newsletter-close').setAttribute('aria-label', 'Close newsletter welcome');
          const close = dialog.querySelector('[data-newsletter-dismiss]');
          close.textContent = 'Close';
          close.classList.remove('newsletter-button-secondary');
          if (dialog.open) close.focus({ preventScroll: true });
        } else {
          status(message, 'You’re subscribed! Look out for a welcome email from TLB.');
          button.textContent = 'Subscribed';
        }
      } catch (error) {
        status(message, error.message || 'We could not complete your signup. Please try again.', true);
        button.disabled = false; button.textContent = label;
      } finally { delete form.dataset.busy; }
    });
  });
}

export async function mountNewsletterPreferences(container, email) {
  if (!container) return;
  container.innerHTML = '<h2>Email preferences</h2><p>Choose whether to receive the TLB newsletter. Your order and payment emails stay on.</p><p class="muted" role="status">Loading your preference…</p>';
  try {
    const result = await request('status', {});
    if (!container.isConnected) return;
    renderPreference(result.status);
  } catch (error) {
    if (!container.isConnected) return;
    container.innerHTML = `<h2>Email preferences</h2><p class="newsletter-status" data-error="true" role="status">${escape(error.message)}</p><button type="button" class="newsletter-button newsletter-button-secondary" data-retry-preference>Try again</button>`;
    container.querySelector('[data-retry-preference]').onclick = () => mountNewsletterPreferences(container, email);
  }
  function renderPreference(current) {
    rememberPreference(current);
    const optedIn = current === 'subscribed';
    container.innerHTML = `<h2>Email preferences</h2><p>Choose whether to receive the TLB newsletter. Your order and payment emails stay on.</p>
      <form data-newsletter-preferences><label class="newsletter-check"><input type="checkbox" name="newsletter" ${optedIn ? 'checked' : ''}><span>Subscribe to TLB’s newsletter<small>New subscribers get a single-use 5% code: 30 days, ₱300 minimum products, up to ₱100 off, delivery excluded. More subscriber-only offers to follow. Unsubscribe anytime.</small></span></label>
      <p class="muted">${current === 'subscribed' ? 'You’re subscribed to the TLB newsletter.' : 'You’re not subscribed to the TLB newsletter.'}</p>
      <button class="newsletter-button" type="submit">Save email preference</button>
      <p class="newsletter-status" role="status" data-newsletter-status hidden></p></form>`;
    const form = container.querySelector('form');
    const message = form.querySelector('[data-newsletter-status]');
    let busy = false;
    const save = async () => {
      if (busy) return;
      const checked = form.elements.newsletter.checked;
      if (checked === optedIn) { status(message, 'Your email preference is already saved.'); return; }
      busy = true;
      form.querySelectorAll('button,input').forEach(node => node.disabled = true);
      try {
        const subscribe = checked;
        await request(subscribe ? 'subscribe' : 'unsubscribe', subscribe ? { email, source: 'account', website: '' } : {});
        if (!container.isConnected) return;
        renderPreference(subscribe ? 'subscribed' : 'unsubscribed');
        status(container.querySelector('[data-newsletter-status]'), subscribe ? 'You’re subscribed! Look out for a welcome email from TLB.' : 'You’re unsubscribed from the TLB newsletter. Your order and payment emails are unchanged.');
      } catch (error) {
        status(message, error.message || 'We could not save your preference. Please try again.', true);
        form.querySelectorAll('button,input').forEach(node => node.disabled = false);
      } finally { busy = false; }
    };
    form.onsubmit = event => { event.preventDefault(); save(); };
  }
}

function renderLanding() {
  if (!landing) return;
  if (!linkToken || !linkAction) {
    landing.innerHTML = `<p class="newsletter-eyebrow">The TLB Newsletter</p><h1>Get <strong>5% off</strong> your next order</h1><p>New subscribers get a welcome code by email. Stay tuned for more offers exclusively for newsletter subscribers.</p>${formMarkup('homepage', 'newsletter-page')}<p class="newsletter-fine">Already subscribed? Use the unsubscribe link in any newsletter, or <a href="account.html">manage your account preferences</a>.</p>`;
    mountNewsletterForms(landing); return;
  }
  const confirming = linkAction === 'confirm';
  landing.innerHTML = `<p class="newsletter-eyebrow">The TLB Newsletter</p><h1>${confirming ? 'A little sweetness in your inbox' : 'Unsubscribe from the newsletter'}</h1><p>${confirming ? 'Confirm that you’d like occasional TLB emails about new treats, seasonal menus, and special offers. You can unsubscribe anytime.' : 'Stop receiving TLB’s newsletter and special offers. Your order and payment emails will continue.'}</p><button class="newsletter-button" id="newsletter-link-action" type="button">${confirming ? 'Confirm subscription' : 'Unsubscribe'}</button><p class="newsletter-status" id="newsletter-link-status" role="status" hidden></p><p class="newsletter-fine"><a href="shop.html">Back to the shop</a></p>`;
  const button = document.getElementById('newsletter-link-action');
  button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await request(linkAction, { token: linkToken });
      linkToken = '';
      rememberPreference(confirming ? 'subscribed' : 'unsubscribed');
      landing.innerHTML = `<p class="newsletter-eyebrow">The TLB Newsletter</p><h1>${confirming ? 'You’re on the list!' : 'You’re unsubscribed'}</h1><p>${confirming ? 'Thanks for joining the TLB newsletter. Look out for fresh treats and news from our kitchen.' : 'You won’t receive TLB newsletters. Your order and payment emails are unchanged.'}</p><a class="newsletter-button" href="shop.html">Explore the shop</a>`;
    } catch (error) {
      status(document.getElementById('newsletter-link-status'), error.message || 'This link could not be used. Please sign up again.', true);
      button.disabled = false;
      if (confirming && !landing.querySelector('[data-newsletter-form]')) {
        landing.insertAdjacentHTML('beforeend', `<h2 style="margin-top:24px">Sign up again</h2>${formMarkup('homepage', 'newsletter-retry')}`);
        mountNewsletterForms(landing);
      }
    }
  };
}

function normalShop() {
  return document.body.hasAttribute('data-newsletter-shop') && new URLSearchParams(location.search).get('demo') !== '1' && !new URLSearchParams(location.hash.slice(1)).has('order');
}

async function setupShopPopup() {
  if (!normalShop()) return;
  let user = null, granted = false, finished = false, checking = false;
  let dialog;
  // The five-second pause starts on page entry, not after a network request.
  const earliest = Date.now() + 5000;
  try {
    const session = await (await service()).newsletterSession();
    user = session?.user || null;
    if (user) {
      if (seenHere()) { await request('popup_seen', {}); return; }
      const preference = await request('status', {});
      if (['subscribed', 'pending'].includes(preference.status) || preference.popup_seen) return;
    } else if (seenHere() || subscribedHere()) return;
  } catch { return; /* Avoid prompting a subscriber while their status is unknown. */ }
  const blocked = () => document.hidden || !normalShop() || Boolean(document.querySelector('dialog[open]')) || Boolean(document.querySelector('#app .loading'));
  const cleanUp = () => { finished = true; clearTimeout(timer); observer.disconnect(); document.removeEventListener('visibilitychange', check); window.removeEventListener('hashchange', check); };
  const check = async () => {
    if (finished || checking) return;
    if (!normalShop() || seenHere()) { cleanUp(); return; }
    if (Date.now() < earliest || blocked()) return;
    checking = true;
    try {
      // Re-read identity just before claiming. Signing in in another tab during
      // the initial delay must still respect that account’s permanent record.
      const currentSession = await (await service()).newsletterSession();
      const nextUser = currentSession?.user || null;
      if (nextUser?.id !== user?.id) {
        user = nextUser; granted = false;
        if (user) {
          const preference = await request('status', {});
          if (['subscribed', 'pending'].includes(preference.status) || preference.popup_seen) { cleanUp(); return; }
        } else if (subscribedHere()) { cleanUp(); return; }
      }
      if (!user && subscribedHere()) { cleanUp(); return; }
      if (user && !granted) {
        const result = await request('popup_claim', {});
        if (!result.show) { cleanUp(); return; }
        granted = true;
      }
      if (finished || !normalShop() || blocked() || seenHere()) return;
      dialog = document.createElement('dialog');
      dialog.className = 'newsletter-dialog'; dialog.id = 'newsletter-dialog';
      dialog.setAttribute('aria-labelledby', 'newsletter-popup-title');
      dialog.setAttribute('aria-describedby', 'newsletter-popup-copy');
      dialog.innerHTML = `<button class="newsletter-close" type="button" aria-label="Close newsletter invitation">×</button><img class="newsletter-mark" src="assets/img/brands/Hat.png" alt=""><p class="newsletter-eyebrow">The TLB Newsletter</p><h2 class="newsletter-title" id="newsletter-popup-title">Get <strong>5% off</strong> your next order</h2><p class="newsletter-copy" id="newsletter-popup-copy">New subscribers get a welcome code by email. Stay tuned for more offers exclusively for newsletter subscribers.</p>${formMarkup('shop_popup', 'newsletter-popup', user?.email || '')}<button class="newsletter-button newsletter-button-secondary" type="button" data-newsletter-dismiss>Maybe later</button>`;
      document.body.append(dialog);
      mountNewsletterForms(dialog);
      dialog.querySelector('.newsletter-close').onclick = () => dialog.close();
      dialog.querySelector('[data-newsletter-dismiss]').onclick = () => dialog.close();
      dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      const showOnce = () => {
        if (seenHere() || !normalShop() || blocked() || !markShown(!user)) return false;
        dialog.showModal();
        return true;
      };
      // Web Locks makes the guest check/write/show atomic across tabs on
      // browsers that support it. The permanent local flag remains the source
      // of truth; no additional identity or tracking identifier is introduced.
      const shown = !user && navigator.locks?.request
        ? await navigator.locks.request('tlb-newsletter-popup', { mode: 'exclusive' }, showOnce)
        : showOnce();
      cleanUp();
      if (!shown) { dialog.remove(); return; }
      // Another modal may be opened by the app after ours appeared. Close our
      // invitation immediately so it can never cover checkout or product UI.
      const overlap = new MutationObserver(() => { if ([...document.querySelectorAll('dialog[open]')].some(node => node !== dialog) || !normalShop()) dialog.close(); });
      overlap.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
      const onHash = () => { if (!normalShop()) dialog.close(); };
      window.addEventListener('hashchange', onHash);
      dialog.addEventListener('close', () => { overlap.disconnect(); window.removeEventListener('hashchange', onHash); }, { once: true });
    } catch { cleanUp(); } finally { checking = false; }
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  document.addEventListener('visibilitychange', check);
  window.addEventListener('hashchange', check);
  const timer = setTimeout(check, Math.max(0, earliest - Date.now()));
}

mountNewsletterForms();
renderLanding();
if (landing) window.addEventListener('hashchange', () => { captureLink(); renderLanding(); });
setupShopPopup();

