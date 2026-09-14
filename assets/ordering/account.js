import { api, auth, authLink, ready, configured, initializationError, escapeHtml as esc, money, formatDate, toast } from './client.js';

const root = document.getElementById('account-root');
const page = document.body.dataset.accountPage;
const params = new URLSearchParams(location.search);
let mode = ['signup', 'recover', 'resend'].includes(params.get('mode')) ? params.get('mode') : 'signin';
let email = '';
let currentUser = null;
let renderVersion = 0;
let authChangeTimer;
let submitting = false;

// Only this site's ordering destinations can be used after authentication.
// In particular, protocol-relative URLs and another site's login redirects
// cannot become navigation targets through a next= query parameter.
function safeNext(value) {
  if (!value || /[\u0000-\u001f\\]/.test(value)) return 'shop.html';
  try {
    const target = new URL(value, new URL('./', location.href));
    const allowed = ['shop.html', 'account.html', 'manage.html'].map(path => new URL(path, new URL('./', location.href)).pathname);
    if (target.origin !== location.origin || !allowed.includes(target.pathname)) return 'shop.html';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return 'shop.html'; }
}

let rememberedNext;
try { rememberedNext = sessionStorage.getItem('tlb-auth-return-v1'); } catch { /* Storage may be restricted in private browser contexts. */ }
const next = safeNext(params.get('next') || rememberedNext);
try { if (params.has('next')) sessionStorage.setItem('tlb-auth-return-v1', next); } catch { /* The explicit next query still works without storage. */ }
const guestNext = new URL(next, location.href).pathname.endsWith('/manage.html') ? 'shop.html' : next;
const returnLabel = new URL(next, location.href).pathname.endsWith('/manage.html') ? 'Continue to staff dashboard' : 'Continue to your order';
const redirect = (path) => new URL(path, location.href).href;
const statusText = value => String(value || '').replace(/_/g, ' ').replace(/^./, value => value.toUpperCase());

function notice(message, type = 'notice') {
  const node = document.getElementById('account-notice');
  if (!node) { toast(message, type); return; }
  node.className = `notice ${type === 'danger' ? 'danger' : type === 'success' ? 'success' : ''}`;
  node.textContent = message;
  node.hidden = false;
  node.focus({ preventScroll: true });
}

function friendlyError(error, context = '') {
  const message = error?.message || '';
  if (/rate.?limit|too many|security purposes|after \d+ seconds/i.test(message)) return 'There have been several recent attempts. Please wait a minute before trying again.';
  if (/fetch|network|connection/i.test(message)) return 'We could not connect to the account service. Please check your connection and try again.';
  if (context === 'signin') return 'We could not verify that email and password. Check your details, or request a new verification email below.';
  if (/password/i.test(message)) return 'Choose a different password with at least 10 characters. Avoid passwords that have appeared in data breaches.';
  return 'We could not complete this request. Please try again shortly or contact the kitchen if the problem continues.';
}

function disconnectedNotice() {
  return `<div class="notice">${esc(initializationError ? 'The account service could not be loaded. Please try again later.' : 'Backend setup is pending. Sign-in, verification emails, and order history will become available after the shop owner connects the ordering service.')}</div>`;
}

function accountForm() {
  const titles = { signin: 'Welcome back', signup: 'Make yourself at home', recover: 'Forgot your password?', resend: 'Verify your email' };
  const descriptions = {
    signin: 'Sign in to see your orders and use your eligible promo codes.',
    signup: 'Create your account, then verify your email to use promo codes.',
    recover: 'Enter your email address to request a secure password reset link.',
    resend: 'Request a replacement verification link if yours has expired or has not arrived.',
  };
  const buttons = { signin: 'Sign in', signup: 'Create account', recover: 'Request reset link', resend: 'Request verification email' };
  const disabled = !configured || Boolean(initializationError);
  return `<section class="panel account-card" aria-labelledby="auth-title">
    <div class="account-tabs" aria-label="Account options"><button type="button" class="button ${mode === 'signin' ? '' : 'button-quiet'}" data-mode="signin" aria-pressed="${mode === 'signin'}">Sign in</button><button type="button" class="button ${mode === 'signup' ? '' : 'button-quiet'}" data-mode="signup" aria-pressed="${mode === 'signup'}">Create account</button></div>
    <h2 id="auth-title">${titles[mode]}</h2><p class="muted">${descriptions[mode]}</p>
    ${disabled ? disconnectedNotice() : ''}
    <div id="account-notice" role="status" tabindex="-1" hidden></div>
    <form id="auth-form"><fieldset ${disabled ? 'disabled' : ''} style="border:0;padding:0;margin:0">
      <label class="field">Email address<input name="email" type="email" autocomplete="email" maxlength="254" required value="${esc(email)}" placeholder="you@example.com"></label>
      ${['signin', 'signup'].includes(mode) ? `<label class="field">Password<input name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" ${mode === 'signup' ? 'minlength="10"' : ''} maxlength="128" required ${mode === 'signup' ? 'aria-describedby="password-hint"' : ''}></label>${mode === 'signup' ? '<p class="muted" id="password-hint">Use at least 10 characters. A memorable phrase works well.</p><label class="field">Confirm password<input name="confirm_password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>' : ''}` : ''}
      <button class="button" type="submit">${buttons[mode]}</button>
    </fieldset></form>
    <div class="dialog-actions"><button class="button button-quiet" type="button" data-mode="recover">Forgot password?</button><button class="button button-quiet" type="button" data-mode="resend">Resend verification</button></div>
  </section>`;
}

function renderSignedOut() {
  renderVersion++;
  root.innerHTML = `<div class="account-layout"><section><p class="eyebrow">Made for sweet moments</p><h1>A little place for<br>your favourite bakes.</h1><p>Keep your orders together, follow their progress, and make your next celebration a little easier.</p><p class="muted">Your cart, selected date, and checkout details stay saved on this browser while you sign in.</p><a class="button button-secondary" href="${esc(guestNext)}">Continue as a guest</a><p class="muted">You can order without an account. Promo codes require a verified account.</p></section>${accountForm()}</div>`;
  root.setAttribute('aria-busy', 'false');
  root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    email = root.querySelector('[name="email"]')?.value || email;
    mode = button.dataset.mode;
    renderSignedOut();
    root.querySelector('[name="email"]')?.focus();
  }));
  document.getElementById('auth-form').addEventListener('submit', submitAuth);
}

async function submitAuth(event) {
  event.preventDefault();
  if (submitting || !auth) return;
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  email = String(data.get('email') || '').trim().toLowerCase();
  const password = String(data.get('password') || '');
  if (mode === 'signup' && password !== data.get('confirm_password')) { notice('The passwords do not match. Please enter them again.', 'danger'); return; }
  submitting = true;
  form.querySelector('fieldset').disabled = true;
  try {
    if (mode === 'signin') {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.assign(next);
      return;
    }
    if (mode === 'signup') {
      const { data: result, error } = await auth.signUp({ email, password, options: { emailRedirectTo: redirect('auth-callback.html') } });
      if (error && !/already|registered|exists/i.test(error.message)) throw error;
      if (result?.session) {
        // The backend still enforces verified-email eligibility for promotions.
        // Owner setup must keep Confirm Email enabled in Supabase.
        await renderAccount();
        return;
      }
      notice('If this address is eligible, you will receive a verification link. Check your inbox and spam folder. If you already have an account, sign in or reset your password.', 'success');
    } else if (mode === 'resend') {
      const { error } = await auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirect('auth-callback.html') } });
      if (error && !/not found|already|confirmed|registered/i.test(error.message)) throw error;
      notice('If this account needs verification, a replacement link will be sent. Check your inbox and spam folder, then use the most recent email.', 'success');
    } else {
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo: redirect('reset-password.html') });
      if (error) throw error;
      notice('If an account exists for this address, you will receive a password reset link. Check your inbox and spam folder.', 'success');
    }
  } catch (error) { notice(friendlyError(error, mode), 'danger'); }
  finally { submitting = false; if (form.isConnected) form.querySelector('fieldset').disabled = false; }
}

function orderCard(order) {
  return `<article class="panel"><div class="section-heading"><h3><a href="shop.html#order=${encodeURIComponent(order.id)}">${esc(order.reference)}</a></h3><strong>${esc(money(order.total_cents))}</strong></div><p>${esc(formatDate(order.fulfillment_date))} · ${order.method === 'delivery' ? 'Delivery' : 'Pickup'}</p><p><span class="badge">${esc(statusText(order.payment_status))}</span> <span class="badge">${esc(statusText(order.fulfillment_status))}</span></p><p class="muted">${esc((order.items || []).map(item => `${item.quantity} × ${item.name}`).join(' · '))}</p><a class="button button-secondary" href="shop.html#order=${encodeURIComponent(order.id)}">View order &amp; payment details</a></article>`;
}

async function loadHistory(version) {
  const area = document.getElementById('order-history');
  if (!area) return;
  area.setAttribute('aria-busy', 'true');
  try {
    const orders = await api('my_orders');
    if (version !== renderVersion || !area.isConnected) return;
    area.innerHTML = orders.length ? orders.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(orderCard).join('') : '<div class="empty-state"><h3>Your next sweet moment starts here</h3><p>Orders you place while signed in will appear here, including those awaiting payment.</p><a class="button" href="shop.html">Explore the shop</a></div>';
  } catch (error) {
    if (version !== renderVersion || !area.isConnected) return;
    area.innerHTML = `<div class="notice danger">${esc(error.message || 'Your order history could not be loaded. Please try again.')}</div>`;
  } finally { area.setAttribute('aria-busy', 'false'); }
}

async function renderAccount() {
  const version = ++renderVersion;
  if (!configured || initializationError || !auth) { renderSignedOut(); return; }
  const { data: { user }, error } = await auth.getUser();
  if (version !== renderVersion) return;
  currentUser = !error ? user : null;
  if (!currentUser) { renderSignedOut(); return; }
  const verified = Boolean(user.email_confirmed_at);
  root.innerHTML = `<div class="account-header"><div><p class="eyebrow">Your little corner</p><h1>Welcome back</h1><p>${esc(user.email)} <span class="badge">${verified ? 'Email verified' : 'Verification pending'}</span></p></div><div class="dialog-actions"><a class="button button-secondary" href="${esc(next)}">${esc(returnLabel)}</a><a class="button button-quiet" id="staff-link" href="manage.html" hidden>Staff dashboard</a><button class="button button-quiet" id="sign-out" type="button">Sign out</button></div></div><div id="account-notice" role="status" tabindex="-1" hidden></div>${verified ? '' : '<div class="notice"><p>Verify your email to use promo codes.</p><button class="button button-secondary" type="button" id="resend-signed-in">Resend verification email</button></div>'}<section aria-labelledby="orders-title"><div class="section-heading"><div><h2 id="orders-title">Your orders</h2><p class="muted">All orders placed while signed in, including those awaiting payment or under review.</p></div><button class="button button-quiet" id="refresh-orders" type="button">Refresh</button></div><p class="muted">Placed an order as a guest? Open the secure link from your confirmation email.</p><div id="order-history" class="account-orders" aria-live="polite"><p class="muted">Loading your orders…</p></div></section>`;
  root.setAttribute('aria-busy', 'false');
  document.getElementById('sign-out').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    const { error } = await auth.signOut({ scope: 'local' });
    if (error) { event.target.disabled = false; notice('We could not sign you out. Please try again.', 'danger'); return; }
    currentUser = null;
    renderSignedOut();
    // Only Supabase's session is removed. Never clear the saved checkout.
  });
  document.getElementById('refresh-orders').addEventListener('click', () => loadHistory(version));
  document.getElementById('resend-signed-in')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    const { error } = await auth.resend({ type: 'signup', email: user.email, options: { emailRedirectTo: redirect('auth-callback.html') } });
    notice(error ? friendlyError(error) : 'If this account needs verification, a replacement email will be sent.', error ? 'danger' : 'success');
    if (event.target.isConnected) event.target.disabled = false;
  });
  await Promise.allSettled([
    loadHistory(version),
    api('admin_bootstrap').then(() => { if (version === renderVersion) document.getElementById('staff-link')?.removeAttribute('hidden'); }),
  ]);
}

function linkProblem(reset = false) {
  root.innerHTML = `<section class="panel account-card"><p class="eyebrow">Your account</p><h1>This link could not be verified</h1><p>The link may have expired, already been used, or been opened incompletely. Request a fresh link and use the latest email.</p><a class="button" href="account.html?mode=${reset ? 'recover' : 'resend'}">Request a new ${reset ? 'reset' : 'verification'} link</a><p><a href="account.html">Back to sign in</a></p></section>`;
  root.setAttribute('aria-busy', 'false');
}

async function renderCallback() {
  if (!configured || initializationError) {
    if (configured && authLink.failed) { linkProblem(); return; }
    root.innerHTML = `<section class="panel account-card"><h1>Email verification</h1>${disconnectedNotice()}<a class="button button-secondary" href="account.html">Back to your account</a></section>`;
    root.setAttribute('aria-busy', 'false');
    return;
  }
  if (!authLink.received || authLink.failed || authLink.type === 'recovery') { linkProblem(); return; }
  const { data: { user }, error } = await auth.getUser();
  if (error || !user?.email_confirmed_at) { linkProblem(); return; }
  root.innerHTML = `<section class="panel account-card"><p class="eyebrow">You're all set</p><h1>Email verified</h1><p>Your email address is verified. Your saved cart and checkout details are waiting on this browser.</p><div class="dialog-actions"><a class="button" href="${esc(next)}">${esc(returnLabel)}</a><a class="button button-secondary" href="account.html">View your account</a></div></section>`;
  root.setAttribute('aria-busy', 'false');
}

async function renderReset() {
  if (!configured || initializationError) {
    if (configured && authLink.failed) { linkProblem(true); return; }
    root.innerHTML = `<section class="panel account-card"><h1>Reset your password</h1>${disconnectedNotice()}<a class="button button-secondary" href="account.html">Back to sign in</a></section>`;
    root.setAttribute('aria-busy', 'false');
    return;
  }
  const { data: { user }, error } = await auth.getUser();
  if (!authLink.received || authLink.failed || (!authLink.recovery && authLink.type !== 'recovery') || error || !user) { linkProblem(true); return; }
  root.innerHTML = `<section class="panel account-card"><p class="eyebrow">A fresh start</p><h1>Choose a new password</h1><p>Use at least 10 characters and a password you have not used elsewhere.</p><div id="account-notice" role="status" tabindex="-1" hidden></div><form id="reset-form"><label class="field">New password<input type="password" name="password" autocomplete="new-password" minlength="10" maxlength="128" required></label><label class="field">Confirm new password<input type="password" name="confirm_password" autocomplete="new-password" minlength="10" maxlength="128" required></label><button class="button" type="submit">Save new password</button></form></section>`;
  root.setAttribute('aria-busy', 'false');
  document.getElementById('reset-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const password = String(data.get('password'));
    if (password !== data.get('confirm_password')) { notice('The passwords do not match. Please enter them again.', 'danger'); return; }
    submitting = true;
    form.querySelector('button').disabled = true;
    try {
      const { error } = await auth.updateUser({ password });
      if (error) throw error;
      authLink.recovery = false;
      authLink.received = false;
      await auth.signOut({ scope: 'local' });
      history.replaceState(null, '', location.pathname);
      root.innerHTML = '<section class="panel account-card"><p class="eyebrow">All done</p><h1>Password updated</h1><p>You can now sign in with your new password. Your cart and checkout details remain saved on this browser.</p><a class="button" href="account.html">Sign in</a></section>';
    } catch (error) {
      if (/expired|invalid|session|token|not authenticated/i.test(error.message)) linkProblem(true);
      else notice(friendlyError(error), 'danger');
    } finally { submitting = false; if (form.isConnected) form.querySelector('button').disabled = false; }
  });
}

await ready;
try {
  if (page === 'callback') await renderCallback();
  else if (page === 'reset') await renderReset();
  else {
    await renderAccount();
    auth?.onAuthStateChange((event) => {
      // SDK calls must happen outside its auth callback lock.
      if (['SIGNED_OUT', 'USER_UPDATED', 'SIGNED_IN'].includes(event) && !submitting) {
        clearTimeout(authChangeTimer);
        authChangeTimer = setTimeout(() => renderAccount().catch(() => renderSignedOut()), 0);
      }
    });
  }
} catch {
  root.innerHTML = '<section class="panel account-card"><h1>Your account</h1><div class="notice danger">The account service could not be reached. Please refresh the page and try again.</div><a class="button button-secondary" href="shop.html">Back to the shop</a></section>';
  root.setAttribute('aria-busy', 'false');
}
