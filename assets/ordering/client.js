import { config } from './config.js';

const setupMessage = 'Backend setup is pending. Accounts and orders will be available after the shop owner connects the ordering service.';
const currentUrl = new URL(window.location.href);
const authFragment = new URLSearchParams(currentUrl.hash.slice(1));

// Capture only link metadata before the Auth SDK consumes the URL fragment.
// Access and refresh tokens are handled exclusively by the Auth SDK.
export const authLink = {
  type: authFragment.get('type') || currentUrl.searchParams.get('type'),
  received: authFragment.has('access_token') || currentUrl.searchParams.has('code') || currentUrl.searchParams.has('token_hash'),
  failed: authFragment.has('error') || currentUrl.searchParams.has('error'),
  recovery: false,
};

function publicConfiguration() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) return false;
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('The ordering service URL must use HTTPS.');
  }
  const key = config.supabasePublishableKey.trim();
  if (key.startsWith('sb_secret_')) throw new Error('A server secret was entered in browser configuration. Remove it and rotate the key immediately.');
  if (key.startsWith('eyJ')) {
    try {
      const body = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      if (JSON.parse(atob(body)).role !== 'anon') throw new Error('Only a publishable or anonymous key belongs in browser configuration.');
    } catch {
      throw new Error('The configured key is not a valid public anonymous key.');
    }
  } else if (!key.startsWith('sb_publishable_')) {
    throw new Error('Configure a Supabase publishable key or legacy anonymous key.');
  }
  return true;
}

export let configured = false;
export let initializationError = null;
export let auth = null;
let supabase = null;
try { configured = publicConfiguration(); } catch (error) { initializationError = error; }

export const ready = (async () => {
  if (!configured) return;
  try {
    // Exact version: updates should be reviewed before changing this URL.
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.102.0');
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'tlb-auth-v1' },
    });
    auth = supabase.auth;
    auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') authLink.recovery = true;
    });
    // Inspect the URL initialization result itself. A previous valid browser
    // session must not make a malformed or expired incoming link look valid.
    const initial = await auth.initialize();
    if (initial.error) { authLink.failed = true; throw initial.error; }
    // Optional token-hash templates are supported in addition to the default
    // Supabase verification links. verifyOtp enforces expiry and single use.
    const tokenHash = currentUrl.searchParams.get('token_hash');
    if (tokenHash && ['signup', 'recovery', 'email', 'email_change'].includes(authLink.type)) {
      const { error } = await auth.verifyOtp({ token_hash: tokenHash, type: authLink.type });
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('token_hash');
      cleanUrl.searchParams.delete('type');
      history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}`);
      if (error) { authLink.failed = true; throw error; }
      if (authLink.type === 'recovery') authLink.recovery = true;
    }
    const { error } = await auth.getSession();
    if (error) { authLink.failed = true; throw error; }
  } catch (error) {
    initializationError = error;
  }
})();

async function connection() {
  await ready;
  if (initializationError) throw new Error(initializationError.message || 'The ordering service could not be reached. Please try again.');
  if (!configured || !supabase) throw new Error(setupMessage);
  return supabase;
}

async function edge(name, body, options = {}) {
  const client = await connection();
  const { data, error } = await client.functions.invoke(name, { body, ...options });
  if (error) {
    let message = error.message || 'The upload service could not complete this request.';
    try {
      const response = await error.context?.clone().json();
      message = response?.error || response?.message || message;
    } catch { /* A gateway/network error may not return JSON. */ }
    throw new Error(typeof message === 'string' ? message : 'The request could not be completed.');
  }
  if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : 'The request could not be completed.');
  return data;
}

export async function api(action, payload = {}, token = null) {
  if (action === 'proof_url') return signedProofUrl(payload.order_id);
  const client = await connection();
  const { data, error } = await client.rpc('shop_api', { p_action: action, p_payload: payload, p_token: token || null });
  if (error) throw new Error(error.message || 'The request could not be completed. Please try again.');
  return data;
}

export async function signedProofUrl(orderId) {
  return edge('proof-url', { order_id: orderId });
}

export async function galleryApi(action, payload = {}) {
  const client = await connection();
  const { data, error } = await client.rpc('gallery_api', { p_action: action, p_payload: payload });
  if (error) throw new Error(error.message || 'The gallery could not be updated. Please try again.');
  return data;
}

export async function partyPackagesApi(action, payload = {}) {
  const client = await connection();
  const { data, error } = await client.rpc('party_packages_api', { p_action: action, p_payload: payload });
  if (error) throw new Error(error.message || 'The party packages could not be updated. Please try again.');
  return data;
}

export async function partyCartItemsApi(action, payload = {}) {
  const client = await connection();
  const { data, error } = await client.rpc('party_cart_items_api', { p_action: action, p_payload: payload });
  if (error) throw new Error(error.message || 'The cart items could not be updated. Please try again.');
  return data;
}

export async function partyCartPhotosApi(action, payload = {}) {
  const client = await connection();
  const { data, error } = await client.rpc('party_cart_photos_api', { p_action: action, p_payload: payload });
  if (error) throw new Error(error.message || 'The party cart photos could not be updated. Please try again.');
  return data;
}

export async function dessertBarPackagesApi(action, payload = {}) {
  const client = await connection();
  const { data, error } = await client.rpc('dessert_bar_packages_api', { p_action: action, p_payload: payload });
  if (error) throw new Error(error.message || 'The dessert bar packages could not be updated. Please try again.');
  return data;
}

export async function dessertBarItemsApi(action, payload = {}) {
  const client = await connection();
  const { data, error } = await client.rpc('dessert_bar_items_api', { p_action: action, p_payload: payload });
  if (error) throw new Error(error.message || 'The dessert bar items could not be updated. Please try again.');
  return data;
}

export async function dessertBarPhotosApi(action, payload = {}) {
  const client = await connection();
  const { data, error } = await client.rpc('dessert_bar_photos_api', { p_action: action, p_payload: payload });
  if (error) throw new Error(error.message || 'The dessert bar photos could not be updated. Please try again.');
  return data;
}

export async function websiteVisitorStats({ signal } = {}) {
  return edge('website-analytics', {}, { signal, timeout: 45_000 });
}

export async function upload(file, { kind = 'proof', order_id, token, payment_reference } = {}) {
  if (!(file instanceof File) || !file.size) throw new Error('Choose a photo to upload.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('The image must be 5 MB or smaller.');
  const body = new FormData();
  body.set('file', file);
  body.set('kind', kind);
  if (order_id) body.set('order_id', order_id);
  if (token) body.set('token', token);
  if (payment_reference) body.set('payment_reference', payment_reference.trim());
  return edge('proof-upload', body);
}

export function money(cents) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function manilaDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(value => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function toast(message, type = 'notice') {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.append(region);
  }
  const item = document.createElement('div');
  item.className = `notice ${['danger', 'success'].includes(type) ? type : ''}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 8000);
}
