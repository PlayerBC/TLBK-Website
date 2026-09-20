import { api, auth, ready, configured, money, escapeHtml, manilaDate, formatDate, toast, upload, websiteVisitorStats } from './client.js?v=party-packages-1';
import { prepareOrderSave, normalizeOrderEditReason } from './order-edit-save.js?v=custom-confirmation-1';
import { confirmOrderTotalChange } from './order-edit-confirmation.js?v=custom-confirmation-1';
import { socialContactMessage } from './checkout-fields.js?v=social-contact-1';
import { fulfillmentStatus, matchesFulfillmentStatus, isActiveFulfillment, needsPaymentReview } from './refund-status.js?v=cancelled-review-1';
import { renderProductPhotos, bindProductPhotoOrder } from './product-photos.js?v=photo-order-1';
import { printOrderSlips } from './order-slips.js?v=batch-slips-1';
import { productLabelSettings, labelTextColor, MAX_LABEL_LENGTH } from './product-label.js';
import { dateCalendar, bindDateCalendars, calendarDates } from './date-calendar.js?v=daily-quantities-1';
import { quantitySelection, quantitySaveRows, quantityStatus } from './daily-quantities.js?v=daily-quantities-1';
import { analyticsDateRange, buildAnalytics } from './analytics.js?v=customer-metrics-1';
import { renderAnalytics } from './analytics-view.js?v=customer-metrics-1';
import { renderWebsiteVisitors, createVisitorPoller } from './website-visitors.js?v=visitors-2';
import { mountGalleryManager } from './gallery-manager.js';
import { mountPartyPackageManager } from './party-package-manager.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const esc = escapeHtml;
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => crypto.randomUUID();
const CLOSED = new Set(['cancelled', 'expired', 'completed']);
const PAYMENT = ['awaiting_payment', 'under_review', 'paid', 'rejected', 'cancelled'];
const FULFILLMENT = ['pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'refunded', 'cancelled', 'expired'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const state = { view: 'overview', role: null, connected: false, products: [], categories: [], inventory: [], promos: [], zones: [], orders: [], settings: {}, staff: [], filters: { search: '', payment: '', fulfillment: '', date: '', method: '', refund: '', upcoming: false }, inventoryDates: [manilaDate()], inventoryDrafts: {} };
state.productFilters = { search: '', status: '', category: '' };
state.promoFilter = '';
state.printSelection = new Set();
let activeOrder = null;
let productDraft = null;
let clearPhotoDrag = () => {};
let editDraft = null;
let modalReturnFocus = null;
let promoStatusTimer = null;
state.analyticsFilter = { period: 'this_month', ...analyticsDateRange('this_month', manilaDate()) };
const visitorPoller = createVisitorPoller({
  fetchReport: websiteVisitorStats,
  onChange(traffic) {
    state.websiteTraffic = traffic;
    const panel = $('#website-visitors');
    if (panel && state.view === 'analytics') panel.innerHTML = renderWebsiteVisitors(traffic, esc);
  },
});
function syncVisitorPolling() { visitorPoller.setActive(state.connected && state.view === 'analytics' && !document.hidden); }
document.addEventListener('visibilitychange', syncVisitorPolling);
window.addEventListener('pagehide', () => visitorPoller.setActive(false));
window.addEventListener('pageshow', syncVisitorPolling);
document.addEventListener('visibilitychange', syncPromoStatuses);
window.addEventListener('pageshow', syncPromoStatuses);
window.addEventListener('pagehide', () => clearTimeout(promoStatusTimer));
const modal = $('#admin-dialog');
window.addEventListener('beforeunload', event => {
  if ($('#party-package-manager')?.dataset.dirty === 'true' || $('#party-package-manager')?.dataset.busy === 'true') { event.preventDefault(); event.returnValue = ''; }
});
bindDateCalendars($('#workspace'));
const label = value => String(value || '').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
const badge = value => `<span class="badge ${esc(value)}${value === 'refunded' ? ' refund' : ''}">${esc(label(value))}</span>`;
const humanDate = value => value ? formatDate(value) : '—';
const dateTime = value => value ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' PHT' : '—';
const amount = cents => (Number(cents || 0) / 100).toFixed(2);
const cents = value => Math.round(Number(value || 0) * 100);
const safeImage = value => typeof value === 'string' && (/^https?:\/\//.test(value) || /^assets\//.test(value)) ? value : '';
const list = value => String(value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
const owner = () => !state.connected || state.role === 'owner';
const readonly = () => state.connected && state.role !== 'owner' ? '<p class="notice">Only an owner can change this section. Your staff role can manage orders and daily quantities.</p>' : '';
const locked = () => !state.connected ? 'disabled title="Connect the backend before saving"' : '';
const ownerLocked = () => !state.connected || state.role !== 'owner' ? 'disabled' : '';
const option = (value, text, selected) => `<option value="${esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
const options = (values, selected, first = 'All') => `${first === null ? '' : option('', first, selected)}${values.map(v => option(v, label(v), selected)).join('')}`;
const input = (name, text, value = '', type = 'text', attrs = '', hint = '') => `<label class="field">${esc(text)}<input name="${esc(name)}" type="${type}" value="${esc(value ?? '')}" ${attrs}>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
const textarea = (name, text, value = '', hint = '', attrs = '') => `<label class="field">${esc(text)}<textarea name="${esc(name)}" ${attrs}>${esc(value ?? '')}</textarea>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
const select = (name, text, markup, attrs = '') => `<label class="field">${esc(text)}<select name="${esc(name)}" ${attrs}>${markup}</select></label>`;
function socialFields(buyer) {
  const platform = String(buyer.social_platform || '').trim().toLowerCase();
  return `<div class="field-row">${select('social_platform', 'Social platform', option('', 'Not recorded', platform) + option('facebook', 'Facebook', platform) + option('instagram', 'Instagram', platform) + option('na', 'N/A', platform))}${input('social_username', 'Username / profile name', platform === 'na' ? 'N/A' : buyer.social_username, 'text', `maxlength="100" ${platform ? 'required' : 'disabled'} ${platform === 'na' ? 'readonly' : ''} data-social-platform="${esc(platform)}"`, 'Enter the customer’s username or profile name, or N/A if unavailable. Older orders may have no social contact recorded.')}</div>`;
}
function syncAdminSocial(form) {
  const platform = form.elements.namedItem('social_platform');
  const username = form.elements.namedItem('social_username');
  if (!platform || !username) return;
  const choice = platform.value;
  username.disabled = !choice;
  username.required = Boolean(choice);
  username.readOnly = choice === 'na';
  if (!choice) username.value = '';
  else if (choice === 'na') username.value = 'N/A';
  else if (username.dataset.socialPlatform === 'na') username.value = '';
  username.dataset.socialPlatform = choice;
}
const check = (name, text, checked = false, attrs = '') => `<label class="check-field"><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''} ${attrs}><span>${esc(text)}</span></label>`;
const formError = '<div class="form-error" role="alert"></div>';
const actions = (text = 'Save changes', permission = 'owner') => `<div class="dialog-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button type="submit" class="button" ${permission === 'owner' ? ownerLocked() : locked()}>${esc(text)}</button></div>`;
const fieldValue = (form, name) => form.elements.namedItem(name)?.value?.trim() ?? '';
const fieldChecked = (form, name) => Boolean(form.elements.namedItem(name)?.checked);
const heading = (title, subtitle, buttons = '') => `<div class="view-heading"><div><span class="eyebrow">The Little Baker Kitchen</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${buttons ? `<div class="row-actions">${buttons}</div>` : ''}</div>`;
const empty = (title, description, action = '') => `<div class="empty-state"><div class="empty-icon" aria-hidden="true">♧</div><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;

function setupNotice() {
  if (state.connected) return '';
  return `<div class="notice"><strong>Draft dashboard · backend setup pending.</strong> You can explore the layout and forms. Saving, accounts, uploads, orders, and email delivery become available after the setup steps are completed. <a href="docs/SETUP.md" target="_blank" rel="noopener">Open setup guide</a></div>`;
}
function showDialog(title, content) {
  clearPhotoDrag();
  if (!modal.open) modalReturnFocus = document.activeElement;
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = content;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
  requestAnimationFrame(() => $('input:not([type=hidden]), select, textarea, button', $('#dialog-body'))?.focus());
}
function closeDialog() { clearPhotoDrag(); modal.close(); modalReturnFocus?.focus?.(); }
$('#dialog-close').addEventListener('click', closeDialog);
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });

async function refresh() {
  if (!configured) return;
  const result = await api('admin_bootstrap');
  Object.assign(state, result, { connected: true, analyticsUpdatedAt: new Date().toISOString() });
  state.products.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
  state.categories.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
  const reviews = state.orders.filter(needsPaymentReview).length;
  $('#review-count').textContent = reviews;
  $('#review-count').hidden = reviews === 0;
  $('#shop-status').textContent = state.settings.paused ? 'New orders paused' : 'Shop accepting orders';
  render();
}
function render() {
  $$('.sidebar-link').forEach(button => { button.classList.toggle('active', button.dataset.view === state.view); button.setAttribute('aria-current', button.dataset.view === state.view ? 'page' : 'false'); });
  const views = { overview: overviewView, analytics: analyticsView, orders: ordersView, products: productsView, inventory: inventoryView, promos: promosView, settings: settingsView, team: teamView, galleries: () => '<div id="gallery-manager"></div>', packages: () => '<div id="party-package-manager"></div>' };
  $('#workspace').innerHTML = setupNotice() + views[state.view]();
  if (state.view === 'galleries') mountGalleryManager($('#gallery-manager'), { role: state.role, connected: state.connected, api: async (...args) => (await import('./client.js?v=party-packages-1')).galleryApi(...args), upload });
  if (state.view === 'packages') mountPartyPackageManager($('#party-package-manager'), { role: state.role, connected: state.connected, api: async (...args) => (await import('./client.js?v=party-packages-1')).partyPackagesApi(...args) });
  syncOrderPrintSelection();
  syncVisitorPolling();
  syncPromoStatuses();
}
function analyticsView() {
  return heading('Analytics', 'Your orders, sales and most-loved products.', `<button class="button button-secondary" data-action="refresh" ${locked()}>Refresh analytics</button>`) + renderAnalytics(state, { today: manilaDate(), money, escapeHtml: esc, formatDate });
}
function overviewView() {
  const today = manilaDate();
  const todayOrders = state.orders.filter(o => o.fulfillment_date === today && isActiveFulfillment(o));
  const reviews = state.orders.filter(needsPaymentReview);
  const upcoming = state.orders.filter(o => o.fulfillment_date >= today && isActiveFulfillment(o)).sort((a, b) => a.fulfillment_date.localeCompare(b.fulfillment_date));
  const activeProducts = state.products.filter(p => p.active).length;
  return heading('A little overview', `Your kitchen, at a glance. ${humanDate(today)} · Manila`, `<button class="button button-secondary" data-action="refresh" ${locked()}>Refresh</button><a class="button" href="shop.html">Open shop ↗</a>`) +
    `<div class="metric-grid">${[
      ['Today’s orders', todayOrders.length, 'Pickup and delivery, active orders'],
      ['Payments to review', reviews.length, 'Proof received · quantities held'],
      ['Upcoming orders', upcoming.length, 'Scheduled today and beyond'],
      ['Active products', activeProducts, 'Availability set by product and date']
    ].map(([title, value, note]) => `<div class="panel metric-card"><div class="metric-label">${title}<span aria-hidden="true">↗</span></div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`).join('')}</div>
    <div class="overview-grid"><section class="panel"><div class="section-heading"><h2>Coming out of the kitchen</h2><button class="button button-quiet" data-action="upcoming">View all →</button></div>${upcoming.length ? orderTable(upcoming.slice(0, 7), true) : empty('Your next bake starts here', 'Scheduled orders will appear here as customers check out. Set up your products and daily quantities to get started.')}</section>
    <section class="panel"><div class="section-heading"><h2>Make the shop your own</h2><span class="badge">Getting started</span></div><ol class="setup-steps"><li><div><strong>Add your menu</strong><p>Photos, prices, categories, and the little details that make each bake yours.</p><button class="button button-quiet" data-view="products">Manage products →</button></div></li><li><div><strong>Plan your baking dates</strong><p>Choose how many of each product can be collected or delivered on each date.</p><button class="button button-quiet" data-view="inventory">Set daily quantities →</button></div></li><li><div><strong>Finish your shop details</strong><p>Add payment details, pickup information, delivery zones, and your production schedule.</p><button class="button button-quiet" data-view="settings">Shop settings →</button></div></li></ol></section></div>
    ${state.settings.paused ? '<p class="notice" style="margin-top:22px">New orders are paused. Existing order links and valid payment-proof uploads remain available.</p>' : ''}
    ${state.connected ? emailStatusCard() : ''}`;
}
function emailStatusCard() {
  const rows = Array.isArray(state.email_status) ? state.email_status : [];
  const counts = rows.reduce((result, row) => { result[row.status] = (result[row.status] || 0) + 1; return result; }, {});
  const problems = rows.filter(row => row.last_error && row.status !== 'sent').slice(0, 4);
  return `<section class="panel" style="margin-top:22px"><div class="section-heading"><h2>Email delivery</h2><a class="button button-quiet" href="docs/SETUP.md" target="_blank" rel="noopener">Email setup →</a></div>${rows.length ? `<p class="muted">Latest ${rows.length} notifications: ${Object.entries(counts).map(([status, count]) => `${count} ${label(status).toLowerCase()}`).map(esc).join(' · ')}</p>` : '<p class="muted">No order notifications queued yet. Email sending requires the configured email service and scheduler.</p>'}${problems.map(row => `<p class="notice danger"><strong>${esc(label(row.event_type))}</strong> · ${esc(state.orders.find(o => o.id === row.order_id)?.reference || 'Order notification')}<br>${esc(row.last_error)}</p>`).join('')}<p class="help-text no-margin">Queued or pending messages have not been confirmed delivered. A sent status means the email provider accepted the message; check the recipient inbox during acceptance testing.</p></section>`;
}
function filteredOrders() {
  const f = state.filters;
  const query = f.search.toLowerCase();
  return state.orders.filter(o => (!query || `${o.reference} ${o.buyer?.name || ''} ${o.buyer?.email || ''} ${o.buyer?.phone || ''}`.toLowerCase().includes(query)) && (!f.payment || (f.payment === 'under_review' ? needsPaymentReview(o) : o.payment_status === f.payment)) && matchesFulfillmentStatus(o, f.fulfillment) && (!f.date || o.fulfillment_date === f.date) && (!f.method || o.method === f.method) && (!f.refund || Boolean(o.refund_label) === (f.refund === 'yes')) && (!f.upcoming || o.fulfillment_date >= manilaDate() && isActiveFulfillment(o))).sort((a, b) => f.upcoming ? a.fulfillment_date.localeCompare(b.fulfillment_date) : b.created_at.localeCompare(a.created_at));
}
function orderTable(orders, compact = false) {
  if (!orders.length) return empty('No orders to show', 'Orders matching your filters will appear here.');
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${compact ? '' : '<th class="order-select-cell"><input type="checkbox" id="select-print-orders" aria-label="Select all shown orders for printing"></th>'}<th>Order / customer</th><th>Fulfillment</th><th>Payment</th>${compact ? '' : '<th>Progress</th>'}<th>Total</th></tr></thead><tbody>${orders.map(order => `<tr>${compact ? '' : `<td class="order-select-cell"><input type="checkbox" data-print-order="${esc(order.id)}" aria-label="Select ${esc(order.reference)} for printing" ${state.printSelection.has(order.id) ? 'checked' : ''}></td>`}<td><button class="table-link" data-action="open-order" data-id="${esc(order.id)}">${esc(order.reference)}</button><small>${esc(order.buyer?.name || 'Customer')}${order.refund_label ? ' · Refund label' : ''}</small></td><td>${esc(humanDate(order.fulfillment_date))}<small>${esc(label(order.method))}</small></td><td>${badge(order.payment_status)}</td>${compact ? '' : `<td>${badge(fulfillmentStatus(order))}</td>`}<td>${money(order.total_cents)}</td></tr>`).join('')}</tbody></table></div>`;
}
function syncOrderPrintSelection() {
  if (state.view !== 'orders') return;
  const shown = new Set(filteredOrders().map(order => order.id));
  state.printSelection.forEach(id => { if (!shown.has(id)) state.printSelection.delete(id); });
  const count = state.printSelection.size;
  const all = $('#select-print-orders');
  if (all) { all.checked = count > 0 && count === shown.size; all.indeterminate = count > 0 && count < shown.size; }
  $$('[data-print-order]').forEach(box => { box.checked = state.printSelection.has(box.dataset.printOrder); });
  const status = $('#print-selection-count');
  if (status) status.textContent = `${count} selected`;
  const button = $('[data-action="print-selected-orders"]');
  if (button) { button.disabled = !count || !state.connected; button.textContent = count ? `Print selected (${count})` : 'Print selected'; }
  const clear = $('[data-action="clear-print-selection"]');
  if (clear) clear.disabled = !count;
}
async function loadPrintOrders(ids) {
  const orders = new Array(ids.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const index = next++;
      orders[index] = await api('get_order', { order_id: ids[index] });
    }
  }));
  return orders;
}
function ordersView() {
  const f = state.filters;
  return heading('Orders', 'From the first checkout to the final handoff.', `<button class="button button-secondary" data-action="export-orders" ${locked()}>Export CSV</button><button class="button" data-action="refresh" ${locked()}>Refresh orders</button>`) + `<section class="panel"><div class="filters"><label>Search<input type="search" id="order-search" data-filter="search" placeholder="Reference, name, email, or phone" value="${esc(f.search)}"></label><label>Payment<select data-filter="payment">${options(PAYMENT, f.payment, 'All payment statuses')}</select></label><label>Fulfillment<select data-filter="fulfillment">${options(FULFILLMENT, f.fulfillment, 'All fulfillment statuses')}</select></label><label>Method<select data-filter="method">${options(['pickup', 'delivery'], f.method, 'Pickup & delivery')}</select></label></div><div class="filter-secondary">${input('filter-date', 'Fulfillment date', f.date, 'date', 'data-filter="date"')}${select('filter-refund', 'Refund label', option('', 'All orders', f.refund) + option('yes', 'With Refund label', f.refund) + option('no', 'Without Refund label', f.refund), 'data-filter="refund"')}<label class="check-field no-margin"><input type="checkbox" data-filter="upcoming" ${f.upcoming ? 'checked' : ''}>Upcoming, grouped by date</label><button class="button button-quiet" data-action="clear-filters">Clear filters</button></div><div class="section-heading"><p class="muted no-margin" id="order-count">${filteredOrders().length} orders</p></div><div class="order-print-actions"><p id="print-selection-count" aria-live="polite">0 selected</p><button class="button button-secondary" data-action="print-selected-orders" disabled>Print selected</button><button class="button button-quiet" data-action="clear-print-selection" disabled>Clear selection</button></div><div id="order-table">${orderTable(filteredOrders())}</div></section>`;
}
function filteredProducts() {
  const { search, status, category } = state.productFilters;
  const query = search.trim().toLowerCase();
  const categoryIds = new Set(state.categories.map(c => c.id));
  return state.products.filter(product =>
    (!query || product.name.toLowerCase().includes(query)) &&
    (!status || Boolean(product.active) === (status === 'active')) &&
    (!category || (category === '__uncategorized__' ? !categoryIds.has(product.category_id) : product.category_id === category))
  );
}
function productFiltersActive() {
  const f = state.productFilters;
  return Boolean(f.search || f.status || f.category);
}
function productResults(products) {
  if (!state.products.length) return `<section class="panel">${empty('Room for something delicious', 'Your ordering catalog starts empty. Add your own products, photos, and prices when you’re ready.', `<button class="button" data-action="new-product" ${owner() ? '' : 'disabled'}>+ Add your first product</button>`)}</section>`;
  return products.length ? `<div class="product-grid">${products.map(product => `<article class="panel product-card"><div class="product-photo">${safeImage(product.photos?.[0]) ? `<img src="${esc(safeImage(product.photos[0]))}" alt="${esc(product.name)}" loading="lazy">` : '<span aria-hidden="true">♧</span>'}</div><div class="product-card-body"><h3>${esc(product.name)}</h3><p class="muted">${esc(state.categories.find(c => c.id === product.category_id)?.name || 'Uncategorized')}</p><div class="product-card-meta"><span>${product.lead_days} full production day${product.lead_days === 1 ? '' : 's'}</span><span>${product.allow_same_day === true ? '<span class="badge">Same-day eligible</span> ' : ''}${product.pickup_only ? '<span class="badge">Pickup only</span> ' : ''}${badge(product.active ? 'active' : 'hidden')}</span></div><div class="product-card-bottom"><strong>${money(product.price_cents)}</strong><button class="button button-quiet" data-action="edit-product" data-id="${esc(product.id)}">${owner() ? 'Edit product' : 'View product'} →</button></div></div></article>`).join('')}</div>` : `<section class="panel">${empty('No matching products', 'Try another product name, status, or category, or clear the filters.')}</section>`;
}
function updateProductResults() {
  const products = filteredProducts();
  $('#product-results').innerHTML = productResults(products);
  $('#product-count').textContent = `Showing ${products.length} of ${state.products.length} product${state.products.length === 1 ? '' : 's'}`;
  $('[data-action="clear-product-filters"]').disabled = !productFiltersActive();
}
function productsView() {
  const f = state.productFilters;
  if (f.category && f.category !== '__uncategorized__' && !state.categories.some(c => c.id === f.category)) f.category = '';
  const products = filteredProducts();
  return heading('Your menu', 'Beautiful bakes, thoughtfully described.', `<button class="button button-secondary" data-action="categories">Categories</button><button class="button" data-action="new-product" ${owner() ? '' : 'disabled'}>+ Add product</button>`) + readonly() +
    `<div class="product-filters" role="search" aria-label="Filter products"><label class="field product-search">Search products<input id="product-search" type="search" data-product-filter="search" placeholder="Search by product name" value="${esc(f.search)}" aria-controls="product-results" autocomplete="off"></label>${select('product-status', 'Status', option('', 'All statuses', f.status) + option('active', 'Active', f.status) + option('hidden', 'Hidden', f.status), 'data-product-filter="status" aria-controls="product-results"')}${select('product-category', 'Category', option('', 'All categories', f.category) + state.categories.map(c => option(c.id, c.name, f.category)).join('') + option('__uncategorized__', 'Uncategorized', f.category), 'data-product-filter="category" aria-controls="product-results"')}</div>` +
    `<div class="product-filter-summary"><p class="muted no-margin" id="product-count" role="status">Showing ${products.length} of ${state.products.length} product${state.products.length === 1 ? '' : 's'}</p><button type="button" class="button button-quiet" data-action="clear-product-filters" ${productFiltersActive() ? '' : 'disabled'}>Clear filters</button></div><div id="product-results">${productResults(products)}</div>`;
}
function inventoryView() {
  return heading('Daily quantities', 'Choose your dates, then set only the limits you need.') +
    `<form data-form="inventory">${formError}<div class="quantity-layout"><aside class="panel quantity-calendar">${dateCalendar('inventory_dates', 'Select dates', state.inventoryDates, 'Choose one or more fulfillment dates.', manilaDate(), !state.connected, { saveLabel: 'Save quantities', selectionLabel: 'Apply quantities to these dates', minDate: manilaDate() })}<p class="quantity-explainer">The same total applies separately to each selected date. Pickup and delivery share the quantity.</p></aside><section class="panel quantity-products"><div class="quantity-products-heading"><div><h2>All products</h2><p>Blank = no limit · 0 = no stock</p></div><span>${state.products.length} products</span></div><p class="quantity-help">Totals include quantities already ordered. Clearing a saved quantity removes its limit. Product availability and shop schedules still apply.</p><div id="quantity-products">${inventoryProducts()}</div><div class="quantity-save"><p id="quantity-save-summary" aria-live="polite">${inventorySaveSummary()}</p><button type="button" class="button button-secondary" data-action="reset-quantities">Reset edits</button><button type="submit" class="button" ${locked()}>Save quantities</button></div></section></div></form>`;
}
function inventorySaveSummary() {
  const count = Object.keys(state.inventoryDrafts).length, dates = state.inventoryDates.length;
  return count ? `${count} edited product${count === 1 ? '' : 's'} will apply to ${dates} selected date${dates === 1 ? '' : 's'}.` : dates ? `${dates} date${dates === 1 ? '' : 's'} selected. Saved limits are shown; mixed limits stay unchanged until edited.` : 'Select at least one date to begin.';
}
function inventoryProducts() {
  return state.products.length ? state.products.map(product => {
    const value = quantitySelection(product.id, state.inventoryDates, state.inventory, state.inventoryDrafts);
    const id = `quantity-${product.id}`, disabled = !state.connected || !state.inventoryDates.length;
    const photo = safeImage(product.photos?.[0]);
    return `<div class="quantity-product" data-quantity-product="${esc(product.id)}"><div class="quantity-photo">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : '<span>No photo</span>'}</div><div class="quantity-product-name"><label for="${esc(id)}">${esc(product.name)}</label>${product.active ? '' : '<span class="quantity-hidden">Hidden from menu</span>'}</div><div class="quantity-control-field"><label class="sr-only" for="${esc(id)}">${esc(product.name)} total quantity per date</label><div class="quantity-input-row"><input id="${esc(id)}" data-quantity-id="${esc(product.id)}" type="number" min="0" max="1000000" step="1" inputmode="numeric" value="${esc(value.value)}" placeholder="${value.mixed ? 'Mixed' : 'No limit'}" aria-describedby="${esc(id)}-status" ${disabled ? 'disabled' : ''}><button type="button" class="button button-quiet" data-action="unlimit-quantity" data-id="${esc(product.id)}" aria-label="Remove limit for ${esc(product.name)}" ${disabled ? 'disabled' : ''}>No limit</button></div><small id="${esc(id)}-status" data-quantity-status>${esc(quantityStatus(value, state.inventoryDates))}</small></div></div>`;
  }).join('') : empty('No products yet', 'Add products to your menu to set daily quantities.');
}
function updateInventoryProducts() {
  $('#quantity-products').innerHTML = inventoryProducts();
  $('#quantity-save-summary').textContent = inventorySaveSummary();
}
function promoStatus(promo, now = Date.now()) {
  const expires = Date.parse(promo.expires_at);
  if (Number.isFinite(expires) && expires <= now) return 'expired';
  return promo.active ? 'active' : 'inactive';
}
function syncPromoStatuses() {
  clearTimeout(promoStatusTimer);
  promoStatusTimer = null;
  if (state.view !== 'promos' || document.hidden) return;
  const results = $('#promo-results');
  if (!results) return;
  const now = Date.now();
  results.innerHTML = promoResults(now);
  const nextExpiry = state.promos.reduce((next, promo) => {
    const expires = Date.parse(promo.expires_at);
    return expires > now ? Math.min(next, expires) : next;
  }, Infinity);
  if (Number.isFinite(nextExpiry)) promoStatusTimer = setTimeout(syncPromoStatuses, Math.min(nextExpiry - now, 2147483647));
}
function promoUsage(promo) {
  const counts = [promo.usage_count, promo.redeemed_count, promo.reserved_count];
  if (!counts.every(value => Number.isSafeInteger(value) && value >= 0)) return '<span class="muted">Usage unavailable</span>';
  return `<strong>${promo.usage_count} / ${promo.global_limit}</strong><small>${promo.redeemed_count} paid · ${promo.reserved_count} reserved</small>`;
}
function filteredPromos(now = Date.now()) {
  return state.promos.filter(promo => !state.promoFilter || promoStatus(promo, now) === state.promoFilter);
}
function promoResults(now = Date.now()) {
  const promos = filteredPromos(now);
  return `<p class="muted" role="status">Showing ${promos.length} of ${state.promos.length} promo codes</p><section class="panel">${promos.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Discount</th><th>Minimum products</th><th>Uses / total limit</th><th>Per account</th><th>Expires · Manila</th><th>Status</th><th></th></tr></thead><tbody>${promos.map(promo => `<tr><td><strong>${esc(promo.code)}</strong></td><td>${promo.kind === 'percent' ? `${promo.value}%` : money(promo.value)}${promo.cap_cents && promo.kind === 'percent' ? `<small>Up to ${money(promo.cap_cents)}</small>` : ''}</td><td>${money(promo.min_subtotal_cents)}</td><td>${promoUsage(promo)}</td><td>${promo.per_account_limit} uses</td><td>${esc(dateTime(promo.expires_at))}</td><td>${badge(promoStatus(promo, now))}</td><td><div class="row-actions"><button class="table-link" data-action="edit-promo" data-id="${esc(promo.id)}">Edit</button><button type="button" class="table-link" data-action="delete-promo" data-id="${esc(promo.id)}" aria-label="Delete promo ${esc(promo.code)}" ${ownerLocked()}>Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : empty(state.promos.length ? 'No matching promo codes' : 'A thoughtful extra, when you’re ready', state.promos.length ? 'Choose another status to see your other promo codes.' : 'Create percentage or fixed-amount discounts with minimum spend and usage limits.')}</section>`;
}
function promosView() {
  return heading('A little treat', 'Promo codes for customers with verified email accounts.', `<button class="button" data-action="new-promo" ${owner() ? '' : 'disabled'}>+ Create promo code</button>`) + readonly() +
    `<div class="filter-secondary">${select('promo-status-filter', 'Status', option('', 'All promo codes', state.promoFilter) + option('active', 'Active', state.promoFilter) + option('expired', 'Expired', state.promoFilter) + option('inactive', 'Inactive', state.promoFilter), 'id="promo-status-filter" aria-controls="promo-results" aria-describedby="promo-filter-help"')}<p id="promo-filter-help" class="muted">Inactive codes have not expired, but are disabled or not yet activated.</p></div><div id="promo-results">${promoResults()}</div><p class="muted">Discounts apply to products and option surcharges. Delivery fees are excluded. Paid and reserved uses both count toward the total limit. Reservations include orders awaiting payment or payment review; expired, rejected or cancelled unpaid orders release them. Paid cancellations and refunds remain counted.</p>`;
}
function deletePromoDialog(id) {
  const promo = state.promos.find(item => item.id === id);
  if (!promo) throw new Error('Promo code not found. Refresh the dashboard and try again.');
  showDialog('Delete promo code', `<form data-form="delete-promo" data-id="${esc(id)}">${formError}<p>Delete <strong>${esc(promo.code)}</strong>?</p><p class="muted">This removes the code from your promo list and stops new uses. Existing order discounts and usage history are kept.</p><p class="notice">This cannot be undone from the dashboard. The code name cannot be reused. To stop it temporarily, edit the code and turn off “Make this code active” instead.</p><div class="dialog-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button type="submit" class="button button-danger" ${ownerLocked()}>Delete promo code</button></div></form>`);
}
function weekdayFields(name, title, values) {
  return `<h3>${esc(title)}</h3><div class="weekday-options">${DAYS.map((day, i) => `<label><input name="${name}" type="checkbox" value="${i}" ${(values ?? [0, 1, 2, 3, 4, 5, 6]).includes(i) ? 'checked' : ''}>${day}</label>`).join('')}</div>`;
}
function settingsView() {
  const s = state.settings;
  return heading('Shop settings', 'The practical details behind every happy order.') + readonly() + `<form data-form="settings">${formError}<div class="settings-grid"><section class="panel"><h2>Your business</h2>${input('shop_name', 'Shop name', s.shop_name || 'The Little Baker Kitchen', 'text', 'required maxlength="120"')}${input('contact_email', 'Contact email', s.contact_email, 'email', 'required')}${input('contact_phone', 'Contact number', s.contact_phone, 'tel', 'required maxlength="40"')}${input('site_url', 'Ordering website URL', s.site_url || '', 'url', 'placeholder="https://your-preview.example"', 'Use the preview URL during testing. Order emails link to this site.')}</section><section class="panel"><h2>Pickup</h2>${textarea('pickup_address', 'Pickup address', s.pickup_address, '', 'required')}${input('pickup_hours', 'Opening hours', s.pickup_hours, 'text', 'placeholder="Enter your actual pickup hours"')}${textarea('pickup_instructions', 'Pickup instructions', s.pickup_instructions)}</section><section class="panel"><h2>Manual payment</h2>${textarea('payment_instructions', 'Payment methods, account details, and instructions', s.payment_instructions, 'Shown after checkout and in the order email. Full initial payment is required. Customers have 15 minutes to upload proof.', 'required rows="8" placeholder="Enter your real payment account details before opening the shop."')}<p class="help-text">The shop does not process payments. Your team reviews each submitted payment proof.</p></section><section class="panel"><h2>Delivery & reminders</h2>${input('delivery_window', 'Delivery window', s.delivery_window || '9:00 AM – 6:00 PM', 'text', 'required') }<p class="help-text">Customers choose a date only. Arrival may be anytime in this window; morning courier booking is not a promised morning arrival.</p>${input('reminder_time', 'Fulfillment-day reminder time · Manila', s.reminder_time || '08:00', 'time', 'required')}${check('reminders_enabled', 'Send reminders for active paid orders due that day', s.reminders_enabled)}<p class="help-text">Requires a configured email service and scheduler. Saved settings alone do not confirm email delivery.</p></section><section class="panel"><h2>Production schedule</h2>${weekdayFields('production_weekdays', 'Production weekdays', s.production_weekdays)}${dateCalendar('nonproduction_dates', 'Additional non-production dates', s.nonproduction_dates, 'These dates do not count toward product lead times. They do not close pickup or delivery bookings.', manilaDate(), Boolean(ownerLocked()))}${input('cutoff_time', 'Optional order cutoff · Manila', s.cutoff_time || '', 'time', '', 'Before the cutoff, today counts if it is an eligible production day. At or after the cutoff, counting starts tomorrow. Leave blank to always start counting tomorrow.')}<p class="help-text">The fulfillment day does not count as a production day. With a 12 PM cutoff and all production days open: a two-day product ordered on September 19 before noon is ready September 21; at or after noon, September 22. Excluded production dates are skipped.</p></section><section class="panel"><h2>Fulfillment availability</h2>${weekdayFields('fulfillment_weekdays', 'Pickup & delivery weekdays', s.fulfillment_weekdays)}${dateCalendar('blocked_dates', 'Dates closed to new fulfillment bookings', s.blocked_dates, 'No new pickup or delivery bookings on these dates. Existing bookings stay intact. These dates can still be production days.', manilaDate(), Boolean(ownerLocked()))}${dateCalendar('delivery_blocked_dates', 'Dates closed to new delivery bookings', s.delivery_blocked_dates, 'Delivery is unavailable on these dates. Pickup remains available unless also closed above. Existing bookings stay intact.', manilaDate(), Boolean(ownerLocked()))}${check('paused', 'Pause new orders', s.paused !== false)}${textarea('pause_message', 'Message while orders are paused', s.pause_message || '', 'Existing order access and eligible proof uploads stay available.')}</section></div><div class="dialog-actions"><button class="button" ${ownerLocked()} type="submit">Save shop settings</button></div></form><section class="panel" style="margin-top:24px"><div class="section-heading"><h2>Delivery zones</h2><button class="button button-secondary" data-action="new-zone" ${owner() ? '' : 'disabled'}>+ Add zone</button></div>${state.zones.length ? state.zones.map(zone => `<div class="zone-card"><div class="section-heading no-margin"><strong>${esc(zone.name)} · ${money(zone.fee_cents)}</strong><span>${badge(zone.active ? 'active' : 'inactive')} <button class="button button-quiet" data-action="edit-zone" data-id="${esc(zone.id)}">Edit</button></span></div><p>${esc(zone.localities.join(' · '))}</p>${zone.description ? `<p class="zone-description">${esc(zone.description)}</p>` : ''}</div>`).join('') : empty('Define where you deliver', 'Add specific city / barangay combinations and their fixed fees. Checkout blocks addresses outside your active covered locations.')}</section>`;
}
function teamView() {
  return heading('Your kitchen team', 'Give the right people access to daily operations.') + readonly() + `<section class="panel"><div class="section-heading"><h2>Team members</h2><button class="button button-secondary" data-action="load-team" ${ownerLocked()}>Refresh team</button></div>${state.staff.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Email</th><th>Role</th></tr></thead><tbody>${state.staff.map(person => `<tr><td>${esc(person.email)}</td><td>${badge(person.role)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Load the team after signing in as an owner. First-owner setup is completed through the protected database setup steps.</p>'}<div class="subsection"><h3>Add or change access</h3><p class="muted">The person must already have a verified customer account. Owners manage the catalog, settings, promo codes, and team. Staff manage orders and daily quantities.</p><form data-form="staff">${formError}<div class="field-row">${input('email', 'Verified account email', '', 'email', 'required')}${select('role', 'Access level', option('staff', 'Staff', 'staff') + option('owner', 'Owner', 'staff') + option('none', 'Remove team access', 'staff'))}</div><button type="submit" class="button" ${ownerLocked()}>Update access</button></form></div></section>`;
}

function openProduct(id) {
  productDraft = clone(state.products.find(p => p.id === id) || { name: '', description: '', category_id: '', price_cents: 0, min_quantity: 1, lead_days: 1, active: false, pickup_only: false, allow_same_day: false, photos: [], option_groups: [], sort_order: 0 });
  renderProductDialog();
}
function captureProduct() {
  const form = $('[data-form="product"]');
  if (!form) return;
  Object.assign(productDraft, { name: fieldValue(form, 'name'), description: fieldValue(form, 'description'), category_id: fieldValue(form, 'category_id') || null, price_cents: cents(fieldValue(form, 'price')), min_quantity: Number(fieldValue(form, 'min_quantity')), lead_days: Number(fieldValue(form, 'lead_days')), sort_order: Number(fieldValue(form, 'sort_order')), active: fieldChecked(form, 'active'), pickup_only: fieldChecked(form, 'pickup_only'), allow_same_day: fieldChecked(form, 'allow_same_day'), label: productLabelSettings({ enabled: fieldChecked(form, 'label_enabled'), text: fieldValue(form, 'label_text'), color: fieldValue(form, 'label_color') }) });
  productDraft.option_groups.forEach((group, gi) => { group.label = fieldValue(form, `group_label_${gi}`); group.required_count = Number(fieldValue(form, `group_count_${gi}`)); group.choices.forEach((choice, ci) => { choice.label = fieldValue(form, `choice_label_${gi}_${ci}`); choice.surcharge_cents = cents(fieldValue(form, `choice_price_${gi}_${ci}`)); choice.active = fieldChecked(form, `choice_active_${gi}_${ci}`); }); });
}
function productLabelEditor(value) {
  const saved = productLabelSettings(value);
  return `<div class="subsection product-label-editor"><h3>Product label</h3><p class="muted">An optional badge on this product’s shop photo. For example: Best seller, New, or Make it yours.</p>${check('label_enabled', 'Show product label', saved.enabled, ownerLocked())}<div class="field-row">${input('label_text', 'Label text', saved.text, 'text', `maxlength="${MAX_LABEL_LENGTH}" placeholder="e.g. Best seller"`, `Up to ${MAX_LABEL_LENGTH} characters.`)}${input('label_color', 'Label color', saved.color, 'color', '', 'Text automatically uses black or white for readability.')}</div><div class="product-label-preview"><span class="muted">Preview</span><span class="product-label" data-label-preview></span><span class="muted" data-label-empty>No label will appear on this product.</span></div></div>`;
}
function updateProductLabelPreview() {
  const form = $('[data-form="product"]');
  const enabled = fieldChecked(form, 'label_enabled');
  const text = form.elements.namedItem('label_text');
  const color = form.elements.namedItem('label_color');
  text.disabled = color.disabled = !enabled || Boolean(ownerLocked());
  text.required = enabled;
  text.setCustomValidity(enabled && !text.value.trim() ? 'Enter text for your product label, or turn the label off.' : '');
  const saved = productLabelSettings({ enabled, text: text.value, color: color.value });
  const preview = $('[data-label-preview]', form);
  preview.hidden = !enabled;
  preview.textContent = saved.text || 'Your label';
  preview.style.backgroundColor = saved.color;
  preview.style.color = labelTextColor(saved.color);
  $('[data-label-empty]', form).hidden = enabled;
}
function canReorderPhotos() {
  const form = $('[data-form="product"]');
  return Boolean(form && !ownerLocked() && !$('button[type="submit"]', form).disabled && form.dataset.busy !== 'true');
}
function bindPhotoOrder() {
  clearPhotoDrag();
  clearPhotoDrag = bindProductPhotoOrder($('#product-photo-order .photo-list'), {
    canMove: canReorderPhotos,
    onMove(from, to) {
      if (!canReorderPhotos() || from === to) return;
      const [photo] = productDraft.photos.splice(from, 1);
      productDraft.photos.splice(to, 0, photo);
      $('#product-photo-order').innerHTML = renderProductPhotos(productDraft.photos, { escapeHtml: esc, safeImage, disabled: false });
      bindPhotoOrder();
      $('#photo-order-status').textContent = `Photo moved to position ${to + 1} of ${productDraft.photos.length}.${to === 0 ? ' This is the menu cover.' : ''}`;
      $(`[data-photo-move="${to}"]`).focus({ preventScroll: true });
    },
  });
}
function renderProductDialog() {
  const p = productDraft;
  showDialog(p.id ? 'Edit product' : 'Add a little deliciousness', `<form data-form="product">${formError}<div class="field-row">${input('name', 'Product name', p.name, 'text', 'required maxlength="160"')}${select('category_id', 'Category', option('', 'Uncategorized', p.category_id || '') + state.categories.map(c => option(c.id, c.name, p.category_id)).join(''))}</div>${textarea('description', 'Description', p.description, 'Describe the bake, what is included, and anything customers should know.', 'maxlength="6000"')}<div class="field-row three">${input('price', 'Base price · PHP', amount(p.price_cents), 'number', 'required min="0" max="9999999" step="0.01"')}${input('min_quantity', 'Minimum sellable units', p.min_quantity, 'number', 'required min="1" max="9999" step="1"', 'For a cookie box, one unit is one whole box.')}${input('lead_days', 'Full production days', p.lead_days, 'number', 'required min="0" max="365" step="1"')}</div><div class="field-row">${input('sort_order', 'Menu display order', p.sort_order, 'number', 'required step="1"')}${check('active', 'Show this product in the shop', p.active)}</div><div class="subsection"><h3>Fulfillment</h3>${check('pickup_only', 'Pickup only — this product cannot be delivered', p.pickup_only === true, ownerLocked())}<p class="help-text">Use for cakes, fragile products, or any item you do not deliver. An order containing this product must use pickup.</p>${check('allow_same_day', 'Allow same-day orders', p.allow_same_day === true, ownerLocked())}<p class="help-text">For ready-stock products with 0 full production days. Same-day orders follow the cutoff in Production schedule; after the cutoff, the earliest date is tomorrow. With no cutoff, same-day orders remain available throughout the day. The fulfillment date must be open with stock available, and every product in the basket must allow same-day orders.</p></div>${productLabelEditor(p.label)}<div class="subsection"><h3>Product photos</h3><p class="muted">JPEG, PNG, or WebP · up to 5 MB each. The first photo is the menu cover. Product photos are public.</p><p class="help-text" id="photo-order-help">Drag photos to rearrange them. On a keyboard, focus a photo and use the arrow keys. Save the product to publish the new order.</p><div id="product-photo-order">${renderProductPhotos(p.photos, { escapeHtml: esc, safeImage, disabled: Boolean(ownerLocked()) })}</div><p class="sr-only" id="photo-order-status" role="status" aria-live="polite" aria-atomic="true"></p>${input('photos', 'Upload photos', '', 'file', `accept="image/jpeg,image/png,image/webp" multiple id="product-photos" ${ownerLocked()}`)}</div><div class="subsection"><div class="section-heading"><h3 class="no-margin">Options & mixed boxes</h3><button type="button" class="button button-secondary" data-action="add-group">+ Add option group</button></div><p class="muted">A required count of 1 creates a single choice. Larger counts let customers build a mix. A box of six requires six selections in total; only the box quantity uses daily stock.</p><div>${p.option_groups.map((group, gi) => `<div class="option-group"><div class="section-heading"><strong>Option group ${gi + 1}</strong><button class="button button-quiet" type="button" data-action="remove-group" data-index="${gi}">Remove group</button></div><div class="field-row">${input(`group_label_${gi}`, 'Group name', group.label, 'text', 'required placeholder="Flavors, size, or packaging"')}${input(`group_count_${gi}`, 'Required selections per unit', group.required_count, 'number', 'required min="1" max="100" step="1"')}</div><div class="option-choices">${group.choices.map((choice, ci) => `<div class="option-choice">${input(`choice_label_${gi}_${ci}`, 'Choice name', choice.label, 'text', 'required')}${input(`choice_price_${gi}_${ci}`, 'Surcharge · PHP / choice', amount(choice.surcharge_cents), 'number', 'required min="0" step="0.01"')}${check(`choice_active_${gi}_${ci}`, 'Available', choice.active !== false)}<button type="button" class="icon-button" data-action="remove-choice" data-group="${gi}" data-index="${ci}" aria-label="Remove choice">×</button></div>`).join('')}</div><button type="button" class="button button-quiet" data-action="add-choice" data-index="${gi}">+ Add choice</button></div>`).join('')}</div></div>${actions(p.id ? 'Save product' : 'Create product')}</form>`);
  bindPhotoOrder();
  updateProductLabelPreview();
  for (const name of ['label_enabled', 'label_text', 'label_color']) {
    $('[data-form="product"]').elements.namedItem(name).addEventListener('input', updateProductLabelPreview);
  }
}
function categoriesDialog() {
  showDialog('Menu categories', `${state.categories.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Category</th><th>Order</th><th></th></tr></thead><tbody>${state.categories.map(c => `<tr><td>${esc(c.name)}</td><td>${c.sort_order}</td><td><button class="table-link" data-action="edit-category" data-id="${esc(c.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Categories help customers browse your menu.</p>'}<div class="dialog-actions"><button class="button button-secondary" data-action="close-dialog">Done</button><button class="button" data-action="new-category" ${owner() ? '' : 'disabled'}>+ Add category</button></div>`);
}
function categoryDialog(id) {
  const c = state.categories.find(item => item.id === id) || { name: '', sort_order: 0 };
  showDialog(c.id ? 'Edit category' : 'Add category', `<form data-form="category" data-id="${esc(c.id || '')}">${formError}${input('name', 'Category name', c.name, 'text', 'required maxlength="100"')}${input('sort_order', 'Display order', c.sort_order, 'number', 'required step="1"')}${c.id ? `<button type="button" class="button button-quiet" data-action="delete-category" data-id="${esc(c.id)}" ${ownerLocked()}>Remove category</button><p class="help-text">Products remain in your catalog and become uncategorized.</p>` : ''}${actions(c.id ? 'Save category' : 'Add category')}</form>`);
}
function zoneDialog(id) {
  const z = state.zones.find(zone => zone.id === id) || { name: '', description: '', localities: [], fee_cents: 0, active: true };
  showDialog(z.id ? 'Edit delivery zone' : 'Add delivery zone', `<form data-form="zone" data-id="${esc(z.id || '')}">${formError}<div class="field-row">${input('name', 'Zone name', z.name, 'text', 'required')}${input('fee', 'Fixed delivery fee · PHP', amount(z.fee_cents), 'number', 'required min="0" step="0.01"')}</div>${textarea('localities', 'Covered city / barangay locations', z.localities.join('\n'), 'One complete location per line, for example “City / Barangay”. Customers select one exact covered location and enter their street address separately. Do not list the same location in multiple active zones.', 'required rows="5"')}${textarea('description', 'Delivery-zone description (optional)', z.description || '', 'Shown to customers when they choose a covered location. For example: If one Lalamove motorcycle is not enough for your order, we will contact you to arrange delivery. This message does not add a fee automatically.', 'maxlength="2000" rows="4"')}${check('active', 'Allow delivery to this zone', z.active)}${actions('Save zone')}</form>`);
}
function localTimestamp(value) { return value ? new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''; }
function promoDialog(id) {
  const p = state.promos.find(promo => promo.id === id) || { code: '', kind: 'percent', value: 10, min_subtotal_cents: 0, cap_cents: null, per_account_limit: 1, global_limit: 100, expires_at: '', active: false };
  showDialog(p.id ? 'Edit promo code' : 'Create promo code', `<form data-form="promo" data-id="${esc(p.id || '')}">${formError}<div class="field-row">${input('code', 'Promo code', p.code, 'text', 'required maxlength="40" pattern="[A-Za-z0-9_-]+" autocomplete="off"')}${select('kind', 'Discount type', option('percent', 'Percentage', p.kind) + option('fixed', 'Fixed amount · PHP', p.kind), 'id="promo-kind"')}</div><div class="field-row">${input('value', p.kind === 'percent' ? 'Discount percentage' : 'Discount · PHP', p.kind === 'percent' ? p.value : amount(p.value), 'number', `required min="${p.kind === 'percent' ? '1' : '.01'}" step="${p.kind === 'percent' ? '1' : '.01'}" ${p.kind === 'percent' ? 'max="100"' : ''} id="promo-value"`)}${input('min_subtotal', 'Minimum product subtotal · PHP', amount(p.min_subtotal_cents), 'number', 'required min="0" step="0.01"')}</div><div class="field-row">${input('cap', 'Maximum percentage discount · PHP', p.cap_cents == null ? '' : amount(p.cap_cents), 'number', `min="0" step="0.01" ${p.kind === 'percent' ? '' : 'disabled'}`, 'Optional. Available only for percentage discounts.')}${input('expires_at', 'Expires at · Manila time', localTimestamp(p.expires_at), 'datetime-local', 'required')}</div><div class="field-row">${input('per_account_limit', 'Maximum uses per verified account', p.per_account_limit, 'number', 'required min="1" step="1"')}${input('global_limit', 'Maximum total uses', p.global_limit, 'number', 'required min="1" step="1"')}</div>${check('active', 'Make this code active', p.active)}<p class="muted">Saved orders keep their reserved discount rules if this code is later edited, expires, or is deactivated. Paid cancellations do not restore a use.</p>${actions('Save promo code')}</form>`);
}

function selectionText(item) {
  if (Array.isArray(item.selection_labels) && item.selection_labels.length) return item.selection_labels.map(v => typeof v === 'string' ? v : `${v.group ? v.group + ': ' : ''}${v.quantity || v.count ? `${v.quantity || v.count} × ` : ''}${v.label || v.name || ''}${Number(v.surcharge_cents) > 0 ? ` (+${money(v.surcharge_cents)} each; +${money(v.surcharge_cents * (v.quantity || v.count || 1))} per unit)` : ''}`).join(' · ');
  const product = state.products.find(p => p.id === item.product_id);
  return Object.entries(item.selections || {}).flatMap(([groupId, choices]) => Object.entries(choices).filter(([, count]) => Number(count) > 0).map(([choiceId, count]) => { const group = product?.option_groups?.find(g => g.id === groupId); const choice = group?.choices.find(c => c.id === choiceId); return `${choice?.label || choiceId} × ${count}${Number(choice?.surcharge_cents) > 0 ? ` (+${money(choice.surcharge_cents)} each; +${money(choice.surcharge_cents * count)} per unit)` : ''}`; })).join(' · ');
}
function itemTable(items) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Product & options</th><th>Units</th><th>Unit price</th><th>Subtotal</th></tr></thead><tbody>${items.map(item => `<tr><td>${esc(item.name)}<small style="white-space:normal">${esc(selectionText(item))}</small></td><td>${item.quantity}</td><td>${money(item.unit_price_cents)}</td><td>${money(item.line_total_cents ?? item.quantity * item.unit_price_cents)}</td></tr>`).join('')}</tbody></table></div>`;
}
function totals(order) {
  return `<div class="order-total"><div><span>Product subtotal</span><span>${money(order.subtotal_cents)}</span></div><div><span>Discount${order.promo_snapshot?.code ? ` · ${esc(order.promo_snapshot.code)}` : ''}</span><span>− ${money(order.discount_cents)}</span></div><div><span>Delivery fee</span><span>${money(order.delivery_cents)}</span></div><div class="grand-total"><span>Current total</span><span>${money(order.total_cents)}</span></div>${order.payment_status === 'paid' ? `<div><span>Original approved payment</span><span>${money(order.paid_amount_cents)}</span></div>` : ''}</div>`;
}
async function openOrder(id) {
  showDialog('Opening order', '<p class="loading-text">Loading the saved order and its history…</p>');
  try { activeOrder = await api('get_order', { order_id: id }); renderOrderDialog(); } catch (error) { showDialog('Unable to open order', `<p class="notice danger">${esc(error.message)}</p>`); }
}
function renderOrderDialog() {
  const o = activeOrder;
  const canProgress = o.payment_status === 'paid' && isActiveFulfillment(o);
  const statuses = ['confirmed', 'preparing', o.method === 'pickup' ? 'ready_for_pickup' : 'out_for_delivery', 'completed'];
  const address = o.address ? [o.address.line1, o.address.line2, o.address.locality, o.address.postal_code].filter(Boolean).join('\n') : '';
  const notes = o.staff_notes || (o.history || []).filter(event => event.action === 'staff_note').map(event => ({ note: event.reason }));
  showDialog(o.reference, `<div id="print-order"><p class="muted">Placed ${esc(dateTime(o.created_at))} · Revision ${o.revision}</p><div class="order-status-row">${badge(o.payment_status)} ${badge(fulfillmentStatus(o))}</div><div class="order-detail-grid"><section class="detail-section"><h3>Buyer</h3><p><strong>${esc(o.buyer?.name)}</strong>\n${esc(o.buyer?.email)}\n${esc(o.buyer?.phone)}</p>${o.buyer?.social_username ? `<p>${esc(o.buyer.social_platform?.toLowerCase() === 'na' ? 'Social contact' : label(o.buyer.social_platform))}: ${esc(o.buyer.social_username)}</p>` : ''}</section><section class="detail-section"><h3>${esc(label(o.method))} · ${esc(humanDate(o.fulfillment_date))}</h3>${o.method === 'delivery' ? `<p><strong>${esc(o.recipient?.name)}</strong>\n${esc(o.recipient?.phone)}\n${esc(address)}</p>` : `<p>${esc(o.pickup_address || state.settings.pickup_address || '')}</p>`}${o.method === 'delivery' && o.delivery_zone_description ? `<p class="zone-description">${esc(o.delivery_zone_description)}</p>` : ''}${o.instructions ? `<p>Instructions: ${esc(o.instructions)}</p>` : ''}</section></div>${itemTable(o.items)}${totals(o)}${o.payment_status === 'paid' && !o.refund_label ? '<p class="muted">Any difference after an order edit is settled directly with the customer. The original payment record and current fulfillment progress are retained.</p>' : ''}<section class="detail-section proof-block"><h3>Initial payment</h3><p>Reference: ${esc(o.payment_reference || 'Not provided')}</p>${o.proof_path ? '<button class="button button-secondary" data-action="view-proof">View private payment proof ↗</button>' : `<p class="muted">${o.payment_status === 'awaiting_payment' && !CLOSED.has(o.fulfillment_status) ? `Proof deadline: ${esc(dateTime(o.payment_deadline))}` : 'No payment proof on this order.'}</p>`}<div id="proof-viewer"></div></section>${o.refund_label ? '<p class="notice">Fulfillment is Refunded. Remove the Refund label to restore the previous fulfillment status. Refund transfers are handled manually.</p>' : ''}<div class="order-toolbar">${needsPaymentReview(o) ? '<button class="button" data-action="payment-approve">Approve full payment</button><button class="button button-secondary" data-action="payment-reject">Reject payment</button>' : ''}${canProgress ? `<select id="next-fulfillment" aria-label="Fulfillment status">${options(statuses, o.fulfillment_status, null)}</select><button class="button button-secondary" data-action="fulfill-order">Update progress</button>` : ''}${!CLOSED.has(o.fulfillment_status) ? '<button class="button button-secondary" data-action="edit-order">Edit order</button><button class="button button-quiet" data-action="cancel-order">Cancel order</button>' : '<button class="button button-secondary" data-action="edit-contact">Edit contact details</button>'}<button class="button button-quiet" data-action="refund-label">${o.refund_label ? 'Remove' : 'Apply'} Refund label</button><button class="button button-quiet" data-action="print-order">Print summary</button></div><section class="private-staff"><h3>Private staff notes</h3>${notes.map(note => `<p class="muted">${esc(typeof note === 'string' ? note : note.note || note.text || '')}</p>`).join('')}<form data-form="staff-note">${formError}${textarea('note', 'Add a private note', '', 'Visible only to authorized team members.', 'required maxlength="4000"')}<button type="submit" class="button button-secondary">Save note</button></form></section><section class="subsection history-block"><h3>Order history</h3><ol class="history">${(o.history || []).slice().reverse().map(event => `<li><strong>${esc(label(event.action))}</strong>${event.reason ? ` — ${esc(event.reason)}` : ''}<small>${esc(dateTime(event.at || event.created_at))} · ${esc(typeof event.actor === 'object' ? event.actor.email || event.actor.id || 'Team member' : event.actor || 'System')}</small>${event.before || event.after ? `<details><summary>View recorded changes</summary><div class="change-grid"><div><strong>Before</strong>${historySnapshot(event.before)}</div><div><strong>After</strong>${historySnapshot(event.after)}</div></div></details>` : ''}</li>`).join('') || '<li>Order history is recorded as changes are made.</li>'}</ol></section></div>`);
}
function historySnapshot(value) {
  if (!value) return '<p>—</p>';
  if (typeof value !== 'object') return `<p>${esc(value)}</p>`;
  return `<dl>${Object.entries(value).filter(([key]) => !/token|proof_path|secret/.test(key)).map(([key, val]) => `<dt>${esc(label(key))}</dt><dd>${key.endsWith('_cents') && typeof val === 'number' ? money(val) : Array.isArray(val) && key === 'items' ? val.map(item => `${item.name || item.product_id} × ${item.quantity} · ${money(item.unit_price_cents)}${selectionText(item) ? ` · ${selectionText(item)}` : ''}`).map(esc).join('<br>') : esc(typeof val === 'object' ? Object.entries(val || {}).map(([k, v]) => `${label(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n') : String(val ?? '—'))}</dd>`).join('')}</dl>`;
}
function orderActionDialog(action) {
  const o = activeOrder;
  const content = {
    'approve_payment': ['Approve full initial payment', `Confirm that you have received ${money(o.total_cents)} in full for ${o.reference}. Approval marks payment Paid. ${o.refund_label ? 'Fulfillment will still display Refunded while the Refund label is applied.' : 'Fulfillment becomes Confirmed.'}`, false],
    'reject_payment': ['Reject payment & close order', 'The order will become Rejected and Cancelled. Held product quantities and the unused promo reservation are released. This order will not accept another proof upload.', true],
    'cancel_order': ['Cancel this order', 'Record why this order is being cancelled. Any pending payment review will close and its payment status will become Cancelled. An approved payment remains Paid. Cancellation does not indicate that a refund has been made.', true],
    'set_refund_label': [o.refund_label ? 'Remove Refund label' : 'Apply Refund label', o.refund_label ? 'Removing the label restores the previous fulfillment status and returns this order to Analytics sales, product rankings and the pickup/delivery breakdown if it is paid and not cancelled or expired. The money transfer remains manual.' : 'A Refund label means a full refund for Analytics. It removes the entire current paid-order total, including delivery after discounts, from sales and excludes the order from product rankings and the pickup/delivery breakdown. The displayed fulfillment status changes to Refunded. You still send the refund manually. The original payment record, stock and promo usage stay unchanged.', true]
  }[action];
  showDialog(content[0], `<form data-form="order-action" data-operation="${action}">${formError}<p class="muted">${esc(content[1])}</p>${action === 'approve_payment' ? `<p class="notice">Payment reference: <strong>${esc(o.payment_reference || '—')}</strong>. Check the private proof and your receiving account before approving.</p>` : ''}${content[2] ? textarea('reason', 'Reason / staff record', '', '', 'required maxlength="4000"') : ''}${action === 'cancel_order' && o.payment_status === 'paid' ? check('restore_stock', 'Return the committed units to sellable quantity. Select only if these units can be sold again.', false) : ''}${action === 'cancel_order' && o.payment_status === 'paid' ? '<p class="help-text">Leave unchecked for units already produced or otherwise not available to sell. Paid remains Paid, and a redeemed promo use stays counted.</p>' : ''}<div class="dialog-actions"><button type="button" class="button button-secondary" data-action="back-order">Back</button><button type="submit" class="button ${action === 'reject_payment' || action === 'cancel_order' ? 'button-danger' : ''}">${esc(content[0])}</button></div></form>`);
}

function contactDialog() {
  const o = activeOrder;
  showDialog(`Contact details · ${o.reference}`, `<form data-form="order-contact">${formError}<p class="notice">This order is closed or completed. You can correct contact information and add notes while preserving its items, fulfillment details, and totals.</p><h3>Buyer details</h3><div class="field-row three">${input('buyer_name', 'Name', o.buyer.name, 'text', 'required')}${input('buyer_email', 'Email', o.buyer.email, 'email', 'required')}${input('buyer_phone', 'Contact number', o.buyer.phone, 'tel', 'required')}</div>${socialFields(o.buyer)}${o.method === 'delivery' ? `<h3>Recipient details</h3><div class="field-row">${input('recipient_name', 'Recipient name', o.recipient?.name, 'text', 'required')}${input('recipient_phone', 'Recipient contact number', o.recipient?.phone, 'tel', 'required')}</div>` : ''}${textarea('instructions', 'Recorded fulfillment instructions', o.instructions || '')}${textarea('reason', 'Reason for correction · optional', '', 'Leave blank to record N/A.', 'maxlength="4000"')}<div class="dialog-actions"><button type="button" class="button button-secondary" data-action="back-order">Back</button><button class="button" type="submit">Save contact correction</button></div></form>`);
}
function configKey(item) {
  const sorted = Object.fromEntries(Object.entries(item.selections || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, Object.fromEntries(Object.entries(values).filter(([, n]) => Number(n) > 0).sort(([a], [b]) => a.localeCompare(b)))]));
  return item.product_id + ':' + JSON.stringify(sorted);
}
function newSelections(product) {
  return Object.fromEntries((product.option_groups || []).map(group => { const first = group.choices.find(choice => choice.active !== false); return [group.id, first ? { [first.id]: group.required_count } : {}]; }));
}
function editItemPrice(item) {
  const existing = activeOrder.items.find(original => configKey(original) === configKey(item));
  if (existing) return existing.unit_price_cents;
  const product = state.products.find(p => p.id === item.product_id);
  return (product?.price_cents || 0) + (product?.option_groups || []).reduce((sum, group) => sum + group.choices.reduce((total, choice) => total + choice.surcharge_cents * Number(item.selections?.[group.id]?.[choice.id] || 0), 0), 0);
}
function savedPromoDiscount(subtotal) {
  const snapshot = activeOrder.promo_snapshot;
  if (!snapshot) return 0;
  const p = snapshot.rules || snapshot;
  if (subtotal < Number(p.min_subtotal_cents || 0)) return 0;
  const discount = p.kind === 'fixed' ? Number(p.value || 0) : Math.round(subtotal * Number(p.value || 0) / 100);
  return Math.min(subtotal, Math.max(0, p.kind === 'percent' && p.cap_cents != null ? Math.min(discount, p.cap_cents) : discount));
}
function captureEdit() {
  const form = $('[data-form="order-edit"]');
  if (!form) return;
  editDraft.fulfillment_date = fieldValue(form, 'fulfillment_date'); editDraft.method = fieldValue(form, 'method');
  editDraft.buyer = { name: fieldValue(form, 'buyer_name'), email: fieldValue(form, 'buyer_email'), phone: fieldValue(form, 'buyer_phone'), social_platform: fieldValue(form, 'social_platform'), social_username: fieldValue(form, 'social_username') };
  editDraft.recipient = { name: fieldValue(form, 'recipient_name'), phone: fieldValue(form, 'recipient_phone') };
  editDraft.address = { locality: fieldValue(form, 'locality'), line1: fieldValue(form, 'line1'), line2: fieldValue(form, 'line2'), postal_code: fieldValue(form, 'postal_code') };
  editDraft.instructions = fieldValue(form, 'instructions'); editDraft.delivery_cents = cents(fieldValue(form, 'delivery_fee')); editDraft.reason = fieldValue(form, 'reason');
  editDraft.items.forEach((item, index) => { item.quantity = Number(fieldValue(form, `qty_${index}`)); const product = state.products.find(p => p.id === item.product_id); if (!product || item.preserve_configuration) return; (product.option_groups || []).forEach((group, gi) => { if (group.required_count === 1) { const choice = fieldValue(form, `selection_${index}_${gi}`); item.selections[group.id] = choice ? { [choice]: 1 } : {}; } else { item.selections[group.id] = Object.fromEntries(group.choices.map((choice, ci) => [choice.id, Number(fieldValue(form, `mix_${index}_${gi}_${ci}`))]).filter(([, count]) => count > 0)); } }); });
}
function startEditOrder() {
  editDraft = clone({ fulfillment_date: activeOrder.fulfillment_date, method: activeOrder.method, buyer: activeOrder.buyer || {}, recipient: activeOrder.recipient || {}, address: activeOrder.address || {}, instructions: activeOrder.instructions || '', delivery_cents: activeOrder.delivery_cents || 0, items: activeOrder.items.map(item => ({ product_id: item.product_id, quantity: item.quantity, selections: item.selections || {}, preserve_configuration: true })), reason: '' });
  renderEditOrder();
}
function editItemMarkup(item, index) {
  const product = state.products.find(p => p.id === item.product_id);
  const original = activeOrder.items.find(i => configKey(i) === configKey(item)) || activeOrder.items.find(i => i.product_id === item.product_id);
  const groups = product?.option_groups || [];
  const configuration = item.preserve_configuration
    ? `<p class="muted"><strong>Saved configuration</strong><br>${esc(selectionText(original || item) || 'No additional options')}</p>${product && (groups.length || Object.keys(item.selections).length) ? `<button type="button" class="button button-quiet" data-action="change-edit-options" data-index="${index}">Choose a different configuration</button>` : ''}`
    : groups.map((group, gi) => `<div><h3>${esc(group.label)} · ${group.required_count} selection${group.required_count === 1 ? '' : 's'} per unit</h3>${group.required_count === 1 ? select(`selection_${index}_${gi}`, 'Selected choice', group.choices.map(choice => option(choice.id, `${choice.label} (+${money(choice.surcharge_cents)})${choice.active === false ? ' · unavailable' : ''}`, Object.keys(item.selections[group.id] || {}).find(key => item.selections[group.id][key] > 0))).join(''), 'data-edit-value') : `<div class="mix-fields">${group.choices.map((choice, ci) => input(`mix_${index}_${gi}_${ci}`, `${choice.label} · +${money(choice.surcharge_cents)}`, item.selections[group.id]?.[choice.id] || 0, 'number', `required min="0" max="${group.required_count}" step="1" data-edit-value`)).join('')}</div>`}</div>`).join('');
  return `<div class="edit-item"><div class="edit-item-top">${select(`product_${index}`, 'Product', `${product ? '' : option(item.product_id, original?.name || 'Archived product', item.product_id)}${state.products.map(p => option(p.id, p.name + (p.active ? '' : ' (hidden)'), item.product_id)).join('')}`, `data-edit-product="${index}" required`)}${input(`qty_${index}`, 'Units', item.quantity, 'number', 'required min="1" max="9999" step="1" data-edit-value')}<button type="button" class="icon-button" data-action="remove-edit-item" data-index="${index}" aria-label="Remove item">×</button></div>${configuration}<p class="line-price" id="edit-price-${index}">${money(editItemPrice(item))} per unit · ${money(editItemPrice(item) * item.quantity)}</p></div>`;
}
function renderEditOrder() {
  const d = editDraft;
  const localityOptions = [...new Set([...state.zones.filter(z => z.active).flatMap(z => z.localities), d.address?.locality].filter(Boolean))];
  showDialog(`Edit ${activeOrder.reference}`, `<form data-form="order-edit">${formError}
    <p class="notice">Admin edits bypass product lead times. Changes to items or the date must still fit the affected daily quantities and fulfillment availability. Saved unit prices stay with unchanged configurations.</p>
    <div class="field-row">${input('fulfillment_date', 'Fulfillment date', d.fulfillment_date, 'date', 'required')}${select('method', 'Method', option('pickup', 'Pickup', d.method) + option('delivery', 'Delivery', d.method), 'id="edit-method"')}</div>
    <h3>Items & configurations</h3>${d.items.map(editItemMarkup).join('')}
    <button type="button" class="button button-secondary" data-action="add-edit-item" ${state.products.length ? '' : 'disabled'}>+ Add product</button>
    <div class="subsection"><h3>Buyer details</h3><div class="field-row three">${input('buyer_name', 'Name', d.buyer.name, 'text', 'required')}${input('buyer_email', 'Email', d.buyer.email, 'email', 'required')}${input('buyer_phone', 'Contact number', d.buyer.phone, 'tel', 'required')}</div>${socialFields(d.buyer)}</div>
    <div class="subsection" id="edit-delivery" ${d.method === 'pickup' ? 'hidden' : ''}><h3>Delivery recipient & address</h3><div class="field-row">${input('recipient_name', 'Recipient name', d.recipient?.name, 'text', d.method === 'delivery' ? 'required' : '')}${input('recipient_phone', 'Recipient contact number', d.recipient?.phone, 'tel', d.method === 'delivery' ? 'required' : '')}</div>${select('locality', 'Covered city / barangay', option('', 'Select location', d.address?.locality) + localityOptions.map(locality => option(locality, locality, d.address?.locality)).join(''), `id="edit-locality" ${d.method === 'delivery' ? 'required' : ''}`)}${input('line1', 'Street address / building', d.address?.line1, 'text', d.method === 'delivery' ? 'required' : '')}<div class="field-row">${input('line2', 'Unit / floor / additional address', d.address?.line2)}${input('postal_code', 'Postal code', d.address?.postal_code)}</div></div>
    <div class="subsection">${textarea('instructions', 'Fulfillment instructions', d.instructions)}${input('delivery_fee', 'Delivery fee override · PHP', amount(d.method === 'pickup' ? 0 : d.delivery_cents), 'number', 'required min="0" step="0.01" data-edit-value', 'The zone fee is suggested when the location changes. You may adjust it for this order.')}<div id="edit-totals"></div><p class="help-text">The total shown is an estimate. Save changes checks prices and availability automatically. If the total changes, you’ll be asked to confirm the old and new totals. Paid-order differences are settled directly with the customer.</p><div id="edit-save-notice"></div>${textarea('reason', 'Reason for these changes · optional', d.reason, 'Leave blank if no note is needed. N/A will be recorded; the changes, staff member, and time are still kept in history.', 'maxlength="4000"')}</div>
    <div class="dialog-actions"><button type="button" class="button button-secondary" data-action="back-order">Back</button><button type="submit" class="button" id="save-order-edit">Save changes</button></div></form>`);
  updateEditPreview();
}
function editChanges() {
  const draft = clone(editDraft);
  if (draft.method === 'pickup') { draft.recipient = null; draft.address = null; draft.delivery_cents = 0; }
  const changes = {};
  for (const key of ['fulfillment_date', 'method', 'buyer', 'recipient', 'address', 'instructions', 'delivery_cents']) if (stable(draft[key]) !== stable(activeOrder[key])) changes[key] = draft[key];
  const items = draft.items.map(({ product_id, quantity, selections }) => ({ product_id, quantity, selections }));
  const originals = activeOrder.items.map(item => ({ product_id: item.product_id, quantity: item.quantity, selections: item.selections || {} }));
  if (stable(items) !== stable(originals)) changes.items = items;
  return changes;
}
function validateEdit() {
  if (!editDraft.items.length) throw new Error('An order must contain at least one product. Use cancellation to close the order.');
  for (const item of editDraft.items) {
    if (item.preserve_configuration) continue;
    const product = state.products.find(p => p.id === item.product_id);
    for (const group of product?.option_groups || []) {
      if (Object.values(item.selections[group.id] || {}).reduce((sum, count) => sum + Number(count), 0) !== group.required_count) throw new Error(`${product.name}: select exactly ${group.required_count} choices for ${group.label} per unit.`);
    }
  }
  const socialError = socialContactMessage(editDraft.buyer.social_platform, editDraft.buyer.social_username, { required: false });
  if (socialError) throw new Error(socialError);
}
function updateEditPreview() {
  const subtotal = editDraft.items.reduce((sum, item) => sum + editItemPrice(item) * item.quantity, 0);
  const discount = savedPromoDiscount(subtotal);
  const fee = editDraft.method === 'pickup' ? 0 : editDraft.delivery_cents;
  editDraft.items.forEach((item, index) => { const element = $(`#edit-price-${index}`); if (element) element.textContent = `${money(editItemPrice(item))} per unit · ${money(editItemPrice(item) * item.quantity)}`; });
  $('#edit-totals').innerHTML = totals({ ...activeOrder, subtotal_cents: subtotal, discount_cents: discount, delivery_cents: fee, total_cents: subtotal - discount + fee });
}

function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(stable(v))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== '').sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, JSON.parse(stable(val))])));
  return JSON.stringify(value ?? null);
}

function validDateList(value, title) {
  const dates = [...new Set(list(value))];
  if (dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) throw new Error(`${title}: a selected date is invalid. Reload shop settings and select the date again.`);
  return dates.sort();
}
function orderMutationPayload(extra = {}) {
  return { order_id: activeOrder.id, revision: activeOrder.revision, idempotency_key: uid(), ...extra };
}
async function updateActive(action, payload) {
  const result = await api(action, payload);
  activeOrder = result;
  await refresh();
  renderOrderDialog();
  toast('Order updated.');
}
async function loadTeam() {
  if (!state.connected) return;
  state.staff = await api('list_staff');
  render();
}
async function onAction(button) {
  if (button.disabled) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const index = Number(button.dataset.index);
  switch (action) {
    case 'unlimit-quantity': state.inventoryDrafts[id] = ''; updateInventoryProducts(); $(`[data-quantity-id="${CSS.escape(id)}"]`)?.focus(); break;
    case 'reset-quantities': state.inventoryDrafts = {}; updateInventoryProducts(); break;
    case 'close-dialog': closeDialog(); break;
    case 'refresh': await Promise.all([refresh(), visitorPoller.refresh()]); toast('Dashboard refreshed.'); break;
    case 'upcoming': state.filters.upcoming = true; state.view = 'orders'; render(); break;
    case 'clear-filters': state.filters = { search: '', payment: '', fulfillment: '', date: '', method: '', refund: '', upcoming: false }; state.printSelection.clear(); render(); break;
    case 'clear-print-selection': state.printSelection.clear(); syncOrderPrintSelection(); break;
    case 'print-selected-orders': {
      const ids = filteredOrders().filter(order => state.printSelection.has(order.id)).map(order => order.id);
      if (ids.length) await printOrderSlips(() => loadPrintOrders(ids), { products: state.products, settings: state.settings });
      break;
    }
    case 'clear-product-filters':
      state.productFilters = { search: '', status: '', category: '' };
      $$('[data-product-filter]').forEach(control => { control.value = ''; });
      updateProductResults(); $('#product-search').focus(); break;
    case 'new-product': openProduct(); break;
    case 'edit-product': openProduct(id); break;
    case 'categories': categoriesDialog(); break;
    case 'new-category': categoryDialog(); break;
    case 'edit-category': categoryDialog(id); break;
    case 'delete-category': showDialog('Remove category', `<form data-form="delete-category" data-id="${esc(id)}">${formError}<p class="muted">Remove this category? Its products remain in your catalog and become uncategorized.</p>${actions('Remove category')}</form>`); break;
    case 'add-group': captureProduct(); productDraft.option_groups.push({ id: uid(), label: '', required_count: 1, choices: [{ id: uid(), label: '', surcharge_cents: 0, active: true }] }); renderProductDialog(); break;
    case 'remove-group': captureProduct(); productDraft.option_groups.splice(index, 1); renderProductDialog(); break;
    case 'add-choice': captureProduct(); productDraft.option_groups[index].choices.push({ id: uid(), label: '', surcharge_cents: 0, active: true }); renderProductDialog(); break;
    case 'remove-choice': captureProduct(); productDraft.option_groups[Number(button.dataset.group)].choices.splice(index, 1); renderProductDialog(); break;
    case 'remove-photo': captureProduct(); productDraft.photos.splice(index, 1); renderProductDialog(); break;
    case 'new-zone': zoneDialog(); break;
    case 'edit-zone': zoneDialog(id); break;
    case 'new-promo': promoDialog(); break;
    case 'edit-promo': promoDialog(id); break;
    case 'delete-promo': deletePromoDialog(id); break;
    case 'load-team': await loadTeam(); break;
    case 'open-order': await openOrder(id); break;
    case 'back-order': renderOrderDialog(); break;
    case 'payment-approve': orderActionDialog('approve_payment'); break;
    case 'payment-reject': orderActionDialog('reject_payment'); break;
    case 'cancel-order': orderActionDialog('cancel_order'); break;
    case 'refund-label': orderActionDialog('set_refund_label'); break;
    case 'fulfill-order': {
      if (activeOrder.refund_label) { toast('Remove the Refund label before updating fulfillment progress.'); break; }
      const status = $('#next-fulfillment').value;
      if (status === activeOrder.fulfillment_status) { toast('This order already has that fulfillment status.'); break; }
      await updateActive('set_fulfillment', orderMutationPayload({ status })); break;
    }
    case 'view-proof': {
      button.disabled = true;
      try {
        const response = await api('proof_url', { order_id: activeOrder.id });
        const url = typeof response === 'string' ? response : response.url;
        if (!/^https:\/\//.test(url || '')) throw new Error('The proof service did not return a valid private viewing link.');
        $('#proof-viewer').innerHTML = `<div style="margin-top:14px"><img class="proof-image" src="${esc(url)}" alt="Submitted payment proof" referrerpolicy="no-referrer"><p class="proof-note">Private viewing link expires in five minutes. Refresh this view if the image no longer loads.</p></div>`;
      } finally { button.disabled = false; }
      break;
    }
    case 'edit-order': startEditOrder(); break;
    case 'edit-contact': contactDialog(); break;
    case 'change-edit-options': captureEdit(); { const item = editDraft.items[index]; const product = state.products.find(p => p.id === item.product_id); item.preserve_configuration = false; item.selections = newSelections(product); } renderEditOrder(); break;
    case 'add-edit-item': captureEdit(); { const product = state.products.find(p => p.active) || state.products[0]; editDraft.items.push({ product_id: product.id, quantity: product.min_quantity || 1, selections: newSelections(product) }); } renderEditOrder(); break;
    case 'remove-edit-item': captureEdit(); editDraft.items.splice(index, 1); renderEditOrder(); break;
    case 'print-order': await printOrderSlips(activeOrder, { products: state.products, settings: state.settings }); break;
    case 'export-orders': exportOrders(); break;
  }
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function exportOrders() {
  const orders = filteredOrders();
  if (!orders.length) { toast('There are no matching orders to export.'); return; }
  const rows = [['Order reference', 'Placed at (Asia/Manila)', 'Fulfillment date', 'Method', 'Payment status', 'Fulfillment status', 'Refund label', 'Buyer name', 'Buyer email', 'Buyer phone', 'Recipient name', 'Recipient phone', 'Address', 'Items', 'Subtotal PHP', 'Discount PHP', 'Delivery PHP', 'Current total PHP', 'Originally approved PHP', 'Payment reference', 'Instructions']];
  orders.forEach(o => rows.push([o.reference, dateTime(o.created_at), o.fulfillment_date, label(o.method), label(o.payment_status), label(fulfillmentStatus(o)), o.refund_label ? 'Yes' : 'No', o.buyer?.name, o.buyer?.email, o.buyer?.phone, o.recipient?.name, o.recipient?.phone, [o.address?.line1, o.address?.line2, o.address?.locality, o.address?.postal_code].filter(Boolean).join(', '), o.items.map(item => `${item.name} × ${item.quantity}${selectionText(item) ? ` (${selectionText(item)})` : ''}`).join('; '), amount(o.subtotal_cents), amount(o.discount_cents), amount(o.delivery_cents), amount(o.total_cents), o.paid_amount_cents == null ? '' : amount(o.paid_amount_cents), o.payment_reference, o.instructions]));
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `tlb-orders-${manilaDate()}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', async event => {
  const view = event.target.closest('[data-view]');
  if (view && $('#gallery-manager')?.dataset.busy === 'true') { toast('Please wait for the gallery operation to finish.'); return; }
  if (view && $('#party-package-manager')?.dataset.busy === 'true') { toast('Please wait for the package operation to finish.'); return; }
  if (view && $('#party-package-manager')?.dataset.dirty === 'true' && !confirm('Discard your unsaved package changes?')) return;
  if (view) { state.view = view.dataset.view; render(); if (state.view === 'analytics' && state.connected) { try { await refresh(); } catch (error) { toast('Analytics could not refresh. The last loaded figures are shown. ' + error.message, 'error'); } } if (state.view === 'team' && state.connected && state.role === 'owner') { try { await loadTeam(); } catch (error) { toast(error.message, 'error'); } } return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  event.preventDefault();
  if (button.dataset.busy === 'true') return;
  button.dataset.busy = 'true';
  try { await onAction(button); } catch (error) { toast(error.message || 'Something went wrong. Please try again.', 'error'); } finally { button.dataset.busy = 'false'; }
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target.hasAttribute('data-quantity-id')) {
    const id = target.dataset.quantityId;
    state.inventoryDrafts[id] = target.value;
    target.placeholder = 'No limit';
    $('[data-quantity-status]', target.closest('[data-quantity-product]')).textContent = quantityStatus(quantitySelection(id, state.inventoryDates, state.inventory, state.inventoryDrafts), state.inventoryDates);
    $('#quantity-save-summary').textContent = inventorySaveSummary();
  }
  if (target.closest('[data-form="order-edit"]')) $('#edit-save-notice').innerHTML = '';
  if (target.dataset.productFilter === 'search') {
    state.productFilters.search = target.value;
    updateProductResults();
    return;
  }
  if (target.dataset.filter) {
    state.printSelection.clear();
    state.filters[target.dataset.filter] = target.type === 'checkbox' ? target.checked : target.value;
    const orders = filteredOrders();
    $('#order-table').innerHTML = orderTable(orders);
    $('#order-count').textContent = `${orders.length} orders`;
    syncOrderPrintSelection();
  }
  if (target.hasAttribute('data-edit-value') && editDraft) { captureEdit(); updateEditPreview(); }
});
document.addEventListener('change', async event => {
  const target = event.target;
  try {
    if (target.id === 'select-print-orders') {
      filteredOrders().forEach(order => target.checked ? state.printSelection.add(order.id) : state.printSelection.delete(order.id));
      syncOrderPrintSelection(); return;
    }
    if (target.hasAttribute('data-print-order')) {
      if (target.checked) state.printSelection.add(target.dataset.printOrder);
      else state.printSelection.delete(target.dataset.printOrder);
      syncOrderPrintSelection(); return;
    }
    if (target.id === 'promo-status-filter') {
      state.promoFilter = target.value;
      syncPromoStatuses();
      return;
    }
    if (target.dataset.productFilter && target.tagName === 'SELECT') {
      state.productFilters[target.dataset.productFilter] = target.value;
      updateProductResults();
      return;
    }
    if (target.name === 'social_platform' && target.closest('[data-form="order-edit"], [data-form="order-contact"]')) {
      syncAdminSocial(target.form);
      if (target.closest('[data-form="order-edit"]')) $('#edit-save-notice').innerHTML = '';
    }
    if (target.id === 'analytics-period') {
      const period = target.value;
      const previousRange = state.analyticsFilter.period === 'custom' ? state.analyticsFilter : analyticsDateRange(state.analyticsFilter.period, manilaDate());
      state.analyticsFilter = { period, ...(period === 'custom' ? { start: previousRange.start || manilaDate(), end: previousRange.end || manilaDate() } : analyticsDateRange(period, manilaDate())) };
      render(); $('#analytics-period')?.focus();
      return;
    }
    if (target.name === 'inventory_dates') { state.inventoryDates = calendarDates(target.value); updateInventoryProducts(); }
    if (target.id === 'promo-kind') {
      target.form.elements.namedItem('cap').disabled = target.value !== 'percent';
      const value = $('#promo-value');
      value.previousSibling.textContent = target.value === 'percent' ? 'Discount percentage' : 'Discount · PHP';
      value.value = ''; value.min = target.value === 'percent' ? '1' : '.01'; value.step = target.value === 'percent' ? '1' : '.01';
      if (target.value === 'percent') value.max = '100'; else value.removeAttribute('max');
    }
    if (target.id === 'product-photos') {
      captureProduct();
      const files = [...target.files];
      if (files.length + productDraft.photos.length > 12) throw new Error('Use up to 12 photos per product.');
      const form = target.closest('form');
      const errorBox = $('.form-error', form); errorBox.textContent = '';
      target.disabled = true;
      const saveButton = $('button[type="submit"]', form); saveButton.disabled = true;
      try {
        for (const file of files) {
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG, or WebP image.');
          if (file.size > 5 * 1024 * 1024) throw new Error('Each image must be 5 MB or smaller.');
          toast(`Uploading ${file.name}…`);
          const result = await upload(file, { kind: 'product' });
          if (!safeImage(result.url)) throw new Error('The upload service did not return a valid image URL.');
          productDraft.photos.push(result.url);
        }
        renderProductDialog(); toast('Photos uploaded. Save the product to publish your changes.');
      } catch (error) { errorBox.textContent = error.message; } finally { target.disabled = !state.connected; saveButton.disabled = !state.connected || state.role !== 'owner'; }
    }
    if (target.hasAttribute('data-edit-product')) {
      captureEdit();
      const index = Number(target.dataset.editProduct);
      const product = state.products.find(p => p.id === target.value);
      editDraft.items[index] = { product_id: product.id, quantity: product.min_quantity || 1, selections: newSelections(product) };
      renderEditOrder();
    }
    if (target.id === 'edit-method') {
      captureEdit();
      editDraft.delivery_cents = editDraft.method === 'pickup' ? 0 : state.zones.find(zone => zone.active && zone.localities.includes(editDraft.address.locality))?.fee_cents || 0;
      renderEditOrder();
    }
    if (target.id === 'edit-locality') {
      captureEdit();
      editDraft.delivery_cents = state.zones.find(zone => zone.active && zone.localities.includes(target.value))?.fee_cents || 0;
      $('[name="delivery_fee"]', target.form).value = amount(editDraft.delivery_cents); updateEditPreview();
    }
  } catch (error) { toast(error.message, 'error'); }
});

document.addEventListener('submit', async event => {
  const analyticsForm = event.target.closest('#analytics-filters');
  if (analyticsForm) {
    event.preventDefault();
    const start = fieldValue(analyticsForm, 'start');
    const end = fieldValue(analyticsForm, 'end');
    if (!analyticsForm.reportValidity()) return;
    if (!start || !end || end > manilaDate() || buildAnalytics([], { start, end, today: manilaDate() }).invalidRange) {
      $('#analytics-filter-error').textContent = 'Choose valid dates, with the end on or after the start and no later than today.';
      return;
    }
    state.analyticsFilter = { period: 'custom', start, end };
    render(); $('#analytics-period')?.focus();
    return;
  }
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.busy === 'true') return;
  const errorBox = $('.form-error', form);
  errorBox.textContent = '';
  if (!state.connected) { errorBox.textContent = 'Complete backend setup and sign in as an authorized team member before saving.'; return; }
  if (!form.reportValidity()) return;
  form.dataset.busy = 'true';
  const submit = $('button[type="submit"]', form); const previousText = submit.textContent;
  submit.disabled = true; submit.textContent = 'Saving…';
  try {
    await submitForm(form);
  } catch (error) {
    errorBox.textContent = error.message || 'Your changes could not be saved. Please try again.';
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } finally { form.dataset.busy = 'false'; submit.disabled = false; submit.textContent = previousText; }
});
async function submitForm(form) {
  const type = form.dataset.form;
  switch (type) {
    case 'product': {
      captureProduct();
      if (productDraft.allow_same_day && productDraft.lead_days !== 0) throw new Error('Same-day orders require 0 full production days. Set full production days to 0, or turn off Allow same-day orders.');
      if (productDraft.label.enabled && !productDraft.label.text) throw new Error('Enter text for your product label, or turn the label off.');
      if (productDraft.option_groups.some(group => !group.choices.length || !group.choices.some(choice => choice.active))) throw new Error('Every option group needs at least one available choice.');
      await api('save_product', { product: productDraft });
      closeDialog(); await refresh(); toast('Product saved.'); break;
    }
    case 'category': await api('save_category', { category: { ...(form.dataset.id ? { id: form.dataset.id } : {}), name: fieldValue(form, 'name'), sort_order: Number(fieldValue(form, 'sort_order')) } }); closeDialog(); await refresh(); toast('Category saved.'); break;
    case 'delete-category': await api('delete_category', { id: form.dataset.id }); closeDialog(); await refresh(); toast('Category removed. Products are preserved.'); break;
    case 'zone': {
      const localities = [...new Set(list(fieldValue(form, 'localities')))];
      if (!localities.length) throw new Error('Add at least one covered city / barangay location.');
      await api('save_zone', { zone: { ...(form.dataset.id ? { id: form.dataset.id } : {}), name: fieldValue(form, 'name'), description: fieldValue(form, 'description'), localities, fee_cents: cents(fieldValue(form, 'fee')), active: fieldChecked(form, 'active') } });
      closeDialog(); await refresh(); toast('Delivery zone saved.'); break;
    }
    case 'inventory': {
      const rows = quantitySaveRows(state.products, state.inventory, state.inventoryDates, state.inventoryDrafts, manilaDate());
      const dateCount = state.inventoryDates.length;
      if (!rows.length) { state.inventoryDrafts = {}; state.inventoryDates = []; render(); toast('Quantities are already up to date.'); break; }
      const controls = [...$$('input, button, textarea', form), ...$$('[data-view]')].filter(control => !control.disabled);
      controls.forEach(control => { control.disabled = true; });
      try {
        state.inventory = await api('save_inventory', { rows });
        state.inventoryDrafts = {};
        state.inventoryDates = [];
        render(); toast(`Quantities saved for ${dateCount} selected date${dateCount === 1 ? '' : 's'}.`);
      } finally { controls.forEach(control => { control.disabled = false; }); }
      break;
    }
    case 'settings': {
      const settings = { ...state.settings };
      ['shop_name', 'contact_email', 'contact_phone', 'pickup_address', 'pickup_hours', 'pickup_instructions', 'site_url', 'payment_instructions', 'delivery_window', 'pause_message', 'reminder_time'].forEach(key => { settings[key] = fieldValue(form, key); });
      settings.paused = fieldChecked(form, 'paused'); settings.reminders_enabled = fieldChecked(form, 'reminders_enabled'); settings.cutoff_time = fieldValue(form, 'cutoff_time') || null;
      settings.production_weekdays = $$('[name="production_weekdays"]:checked', form).map(field => Number(field.value));
      settings.fulfillment_weekdays = $$('[name="fulfillment_weekdays"]:checked', form).map(field => Number(field.value));
      if (!settings.production_weekdays.length || !settings.fulfillment_weekdays.length) throw new Error('Select at least one production weekday and one fulfillment weekday. Use the pause setting to close new orders temporarily.');
      settings.nonproduction_dates = validDateList(fieldValue(form, 'nonproduction_dates'), 'Non-production dates');
      settings.blocked_dates = validDateList(fieldValue(form, 'blocked_dates'), 'Blocked fulfillment dates');
      settings.delivery_blocked_dates = validDateList(fieldValue(form, 'delivery_blocked_dates'), 'Blocked delivery dates');
      await api('save_settings', { settings }); await refresh(); toast('Shop settings saved.'); break;
    }
    case 'delete-promo':
      await api('delete_promo', { id: form.dataset.id });
      state.promos = state.promos.filter(promo => promo.id !== form.dataset.id);
      closeDialog(); render(); toast('Promo code deleted. Existing orders are preserved.'); break;
    case 'promo': {
      const kind = fieldValue(form, 'kind');
      const expiry = new Date(fieldValue(form, 'expires_at') + ':00+08:00');
      if (Number.isNaN(expiry.getTime())) throw new Error('Enter a valid promo expiry date and time in Manila time.');
      const promo = { ...(form.dataset.id ? { id: form.dataset.id } : {}), code: fieldValue(form, 'code').toUpperCase(), kind, value: kind === 'percent' ? Number(fieldValue(form, 'value')) : cents(fieldValue(form, 'value')), min_subtotal_cents: cents(fieldValue(form, 'min_subtotal')), cap_cents: kind === 'percent' && fieldValue(form, 'cap') !== '' ? cents(fieldValue(form, 'cap')) : null, per_account_limit: Number(fieldValue(form, 'per_account_limit')), global_limit: Number(fieldValue(form, 'global_limit')), expires_at: expiry.toISOString(), active: fieldChecked(form, 'active') };
      await api('save_promo', { promo }); closeDialog(); await refresh(); toast('Promo code saved.'); break;
    }
    case 'staff': await api('save_staff', { email: fieldValue(form, 'email'), role: fieldValue(form, 'role') }); await loadTeam(); toast('Team access updated.'); break;
    case 'staff-note': await updateActive('add_staff_note', orderMutationPayload({ note: fieldValue(form, 'note') })); break;
    case 'order-action': {
      const operation = form.dataset.operation;
      const payload = orderMutationPayload({ reason: fieldValue(form, 'reason') });
      if (operation === 'cancel_order') payload.restore_stock = activeOrder.payment_status === 'paid' ? fieldChecked(form, 'restore_stock') : true;
      if (operation === 'set_refund_label') payload.enabled = !activeOrder.refund_label;
      await updateActive(operation, payload); break;
    }
    case 'order-contact': {
      const buyer = { ...activeOrder.buyer, name: fieldValue(form, 'buyer_name'), email: fieldValue(form, 'buyer_email'), phone: fieldValue(form, 'buyer_phone'), social_platform: fieldValue(form, 'social_platform'), social_username: fieldValue(form, 'social_username') };
      const socialError = socialContactMessage(buyer.social_platform, buyer.social_username, { required: false });
      if (socialError) throw new Error(socialError);
      const changes = { buyer, instructions: fieldValue(form, 'instructions') };
      if (activeOrder.method === 'delivery') changes.recipient = { ...activeOrder.recipient, name: fieldValue(form, 'recipient_name'), phone: fieldValue(form, 'recipient_phone') };
      await updateActive('edit_order', orderMutationPayload({ changes, reason: normalizeOrderEditReason(fieldValue(form, 'reason')) })); break;
    }
    case 'order-edit': {
      captureEdit(); validateEdit();
      const changes = editChanges();
      if (!Object.keys(changes).length) throw new Error('There are no changes to save.');
      const original = activeOrder;
      const reason = editDraft.reason;
      const submitted = stable({ changes, reason });
      // Hold this form steady during the server check; restore each control afterward.
      const controls = [...form.elements].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      try {
        const payload = await prepareOrderSave({
          order: original, changes, reason, idempotencyKey: uid(),
          preview: request => api('preview_edit_order', request),
          isCurrent: () => {
            if (!form.isConnected || !modal.open || activeOrder.id !== original.id || activeOrder.revision !== original.revision) return false;
            captureEdit();
            return stable({ changes: editChanges(), reason: editDraft.reason }) === submitted;
          },
          onPreview: checked => {
            $('#edit-totals').innerHTML = totals({ ...original, ...checked });
            $('#edit-save-notice').innerHTML = `${checked.method === 'delivery' && checked.delivery_zone_description ? `<section class="detail-section"><h3>Delivery notes${checked.delivery_zone_name ? ` · ${esc(checked.delivery_zone_name)}` : ''}</h3><p class="zone-description">${esc(checked.delivery_zone_description)}</p></section>` : ''}`;
          },
          confirmTotalChange: details => confirmOrderTotalChange(details, { money, parentDialog: modal }),
        });
        if (!payload) {
          $('#edit-save-notice').insertAdjacentHTML('beforeend', '<p class="notice">Changes have not been saved. You can keep editing or go back to the order.</p>');
          break;
        }
        await updateActive('edit_order', payload);
      } catch (error) {
        if (error.message?.includes('Prices changed since the amendment preview')) throw new Error('Prices or delivery details changed while saving. Click Save changes again to check the latest total.');
        throw error;
      } finally { controls.forEach(([control, disabled]) => { control.disabled = disabled; }); }
      break;
    }
  }
}

async function init() {
  await ready;
  if (!configured) { $('#shop-status').textContent = 'Draft · setup pending'; render(); return; }
  try {
    if (!auth) throw new Error('The account service could not be initialized. Check the public backend configuration.');
    const { data, error } = await auth.getSession();
    if (error) throw error;
    if (!data.session) {
      $('#shop-status').textContent = 'Staff sign-in required';
      $('#workspace').innerHTML = heading('Welcome to the kitchen', 'Sign in with your authorized owner or staff account.') + `<section class="panel">${empty('Your dashboard is private', 'Only an owner or authorized staff member can access shop administration.', '<a class="button" href="account.html?next=manage.html">Sign in to manage the shop</a>')}</section>`;
      $('#admin-nav').hidden = true;
      return;
    }
    await refresh();
    auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { state.connected = false; visitorPoller.reset(); location.replace('account.html?next=manage.html'); } });
  } catch (error) {
    $('#shop-status').textContent = 'Dashboard unavailable';
    $('#admin-nav').hidden = true;
    $('#workspace').innerHTML = heading('Dashboard access', 'Your shop information is protected.') + `<section class="panel"><p class="notice danger">${esc(error.message)}</p><p class="muted">Sign in using an authorized team account. For a new installation, follow the first-owner setup steps.</p><div class="row-actions"><a class="button" href="account.html?next=manage.html">Open account</a><a class="button button-secondary" href="docs/SETUP.md" target="_blank" rel="noopener">Setup guide</a></div></section>`;
  }
}
init();
