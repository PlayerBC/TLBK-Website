import { api, auth, ready, configured, money, escapeHtml, manilaDate, formatDate, toast, upload } from './client.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const esc = escapeHtml;
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => crypto.randomUUID();
const CLOSED = new Set(['cancelled', 'expired', 'completed']);
const PAYMENT = ['awaiting_payment', 'under_review', 'paid', 'rejected'];
const FULFILLMENT = ['pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled', 'expired'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const state = { view: 'overview', role: null, connected: false, products: [], categories: [], inventory: [], promos: [], zones: [], orders: [], settings: {}, staff: [], filters: { search: '', payment: '', fulfillment: '', date: '', method: '', refund: '', upcoming: false }, inventoryDate: manilaDate() };
let activeOrder = null;
let productDraft = null;
let editDraft = null;
let editPreviewKey = null;
let editExpectedQuote = null;
let modalReturnFocus = null;
const modal = $('#admin-dialog');
const label = value => String(value || '').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
const badge = value => `<span class="badge ${esc(value)}">${esc(label(value))}</span>`;
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
  if (!modal.open) modalReturnFocus = document.activeElement;
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = content;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
  requestAnimationFrame(() => $('input:not([type=hidden]), select, textarea, button', $('#dialog-body'))?.focus());
}
function closeDialog() { modal.close(); modalReturnFocus?.focus?.(); }
$('#dialog-close').addEventListener('click', closeDialog);
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });

async function refresh() {
  if (!configured) return;
  const result = await api('admin_bootstrap');
  Object.assign(state, result, { connected: true });
  state.products.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
  state.categories.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
  const reviews = state.orders.filter(o => o.payment_status === 'under_review').length;
  $('#review-count').textContent = reviews;
  $('#review-count').hidden = reviews === 0;
  $('#shop-status').textContent = state.settings.paused ? 'New orders paused' : 'Shop accepting orders';
  render();
}
function render() {
  $$('.sidebar-link').forEach(button => { button.classList.toggle('active', button.dataset.view === state.view); button.setAttribute('aria-current', button.dataset.view === state.view ? 'page' : 'false'); });
  const views = { overview: overviewView, orders: ordersView, products: productsView, inventory: inventoryView, promos: promosView, settings: settingsView, team: teamView };
  $('#workspace').innerHTML = setupNotice() + views[state.view]();
}
function overviewView() {
  const today = manilaDate();
  const todayOrders = state.orders.filter(o => o.fulfillment_date === today && !CLOSED.has(o.fulfillment_status));
  const reviews = state.orders.filter(o => o.payment_status === 'under_review');
  const upcoming = state.orders.filter(o => o.fulfillment_date >= today && !CLOSED.has(o.fulfillment_status)).sort((a, b) => a.fulfillment_date.localeCompare(b.fulfillment_date));
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
  return state.orders.filter(o => (!query || `${o.reference} ${o.buyer?.name || ''} ${o.buyer?.email || ''} ${o.buyer?.phone || ''}`.toLowerCase().includes(query)) && (!f.payment || o.payment_status === f.payment) && (!f.fulfillment || o.fulfillment_status === f.fulfillment) && (!f.date || o.fulfillment_date === f.date) && (!f.method || o.method === f.method) && (!f.refund || Boolean(o.refund_label) === (f.refund === 'yes')) && (!f.upcoming || o.fulfillment_date >= manilaDate() && !CLOSED.has(o.fulfillment_status))).sort((a, b) => f.upcoming ? a.fulfillment_date.localeCompare(b.fulfillment_date) : b.created_at.localeCompare(a.created_at));
}
function orderTable(orders, compact = false) {
  if (!orders.length) return empty('No orders to show', 'Orders matching your filters will appear here.');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Order / customer</th><th>Fulfillment</th><th>Payment</th>${compact ? '' : '<th>Progress</th>'}<th>Total</th></tr></thead><tbody>${orders.map(order => `<tr><td><button class="table-link" data-action="open-order" data-id="${esc(order.id)}">${esc(order.reference)}</button><small>${esc(order.buyer?.name || 'Customer')}${order.refund_label ? ' · Refund label' : ''}</small></td><td>${esc(humanDate(order.fulfillment_date))}<small>${esc(label(order.method))}</small></td><td>${badge(order.payment_status)}</td>${compact ? '' : `<td>${badge(order.fulfillment_status)}</td>`}<td>${money(order.total_cents)}</td></tr>`).join('')}</tbody></table></div>`;
}
function ordersView() {
  const f = state.filters;
  return heading('Orders', 'From the first checkout to the final handoff.', `<button class="button button-secondary" data-action="export-orders" ${locked()}>Export CSV</button><button class="button" data-action="refresh" ${locked()}>Refresh orders</button>`) + `<section class="panel"><div class="filters"><label>Search<input type="search" id="order-search" data-filter="search" placeholder="Reference, name, email, or phone" value="${esc(f.search)}"></label><label>Payment<select data-filter="payment">${options(PAYMENT, f.payment, 'All payment statuses')}</select></label><label>Fulfillment<select data-filter="fulfillment">${options(FULFILLMENT, f.fulfillment, 'All fulfillment statuses')}</select></label><label>Method<select data-filter="method">${options(['pickup', 'delivery'], f.method, 'Pickup & delivery')}</select></label></div><div class="filter-secondary">${input('filter-date', 'Fulfillment date', f.date, 'date', 'data-filter="date"')}${select('filter-refund', 'Refund label', option('', 'All orders', f.refund) + option('yes', 'With Refund label', f.refund) + option('no', 'Without Refund label', f.refund), 'data-filter="refund"')}<label class="check-field no-margin"><input type="checkbox" data-filter="upcoming" ${f.upcoming ? 'checked' : ''}>Upcoming, grouped by date</label><button class="button button-quiet" data-action="clear-filters">Clear filters</button></div><div class="section-heading"><p class="muted no-margin" id="order-count">${filteredOrders().length} orders</p></div><div id="order-table">${orderTable(filteredOrders())}</div></section>`;
}
function productsView() {
  return heading('Your menu', 'Beautiful bakes, thoughtfully described.', `<button class="button button-secondary" data-action="categories">Categories</button><button class="button" data-action="new-product" ${owner() ? '' : 'disabled'}>+ Add product</button>`) + readonly() +
    `<div class="category-chips"><span class="category-chip">All products · ${state.products.length}</span>${state.categories.map(c => `<span class="category-chip">${esc(c.name)}</span>`).join('')}</div>` +
    (state.products.length ? `<div class="product-grid">${state.products.map(product => `<article class="panel product-card"><div class="product-photo">${safeImage(product.photos?.[0]) ? `<img src="${esc(safeImage(product.photos[0]))}" alt="${esc(product.name)}" loading="lazy">` : '<span aria-hidden="true">♧</span>'}</div><div class="product-card-body"><h3>${esc(product.name)}</h3><p class="muted">${esc(state.categories.find(c => c.id === product.category_id)?.name || 'Uncategorized')}</p><div class="product-card-meta"><span>${product.lead_days} full production day${product.lead_days === 1 ? '' : 's'}</span>${badge(product.active ? 'active' : 'hidden')}</div><div class="product-card-bottom"><strong>${money(product.price_cents)}</strong><button class="button button-quiet" data-action="edit-product" data-id="${esc(product.id)}">${owner() ? 'Edit product' : 'View product'} →</button></div></div></article>`).join('')}</div>` : `<section class="panel">${empty('Room for something delicious', 'Your ordering catalog starts empty. Add your own products, photos, and prices when you’re ready.', `<button class="button" data-action="new-product" ${owner() ? '' : 'disabled'}>+ Add your first product</button>`)}</section>`);
}
function inventoryView() {
  const rows = state.inventory.filter(row => row.date === state.inventoryDate);
  return heading('Daily quantities', 'Plan each product, one fulfillment date at a time.') + `<div class="notice inventory-note">Pickup and delivery share the same product quantity on a date. Held and approved quantities count once. A date without an allocation is unavailable. Turning availability off preserves existing orders.</div><section class="panel"><h2>Set a daily allocation</h2><form data-form="inventory">${formError}<div class="inventory-form">${select('product_id', 'Product', option('', 'Choose a product', '') + state.products.map(p => option(p.id, p.name, '')).join(''), 'required')}${input('start_date', 'From date', state.inventoryDate, 'date', 'required')}${input('end_date', 'Through date', state.inventoryDate, 'date', 'required')}<span></span>${input('capacity', 'Total sellable quantity per date', '', 'number', 'min="0" step="1" required', 'Total capacity, including quantities already held or approved.')}${select('available', 'Accept new orders', option('yes', 'Available', 'yes') + option('no', 'Unavailable', 'yes'))}<span></span><button class="button" ${locked()} type="submit">Save allocation</button></div></form></section><section class="panel" style="margin-top:22px"><div class="section-heading"><h2>Quantities by date</h2>${input('inventory-date', 'Fulfillment date', state.inventoryDate, 'date', 'id="inventory-date"')}</div>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Total quantity</th><th>Held + approved</th><th>Remaining</th><th>Availability</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(state.products.find(p => p.id === row.product_id)?.name || 'Archived product')}</td><td>${row.capacity}</td><td>${row.reserved ?? '—'}</td><td>${row.remaining ?? (row.reserved === undefined ? '—' : row.capacity - row.reserved)}</td><td>${badge(row.available ? 'available' : 'unavailable')}</td></tr>`).join('')}</tbody></table></div>` : empty('No quantities set for this date', 'Add an allocation above to make a product available for this fulfillment date.')}</section>`;
}
function promosView() {
  return heading('A little treat', 'Promo codes for customers with verified email accounts.', `<button class="button" data-action="new-promo" ${owner() ? '' : 'disabled'}>+ Create promo code</button>`) + readonly() + `<section class="panel">${state.promos.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Discount</th><th>Minimum products</th><th>Limits</th><th>Expires · Manila</th><th>Status</th><th></th></tr></thead><tbody>${state.promos.map(promo => `<tr><td><strong>${esc(promo.code)}</strong></td><td>${promo.kind === 'percent' ? `${promo.value}%` : money(promo.value)}${promo.cap_cents && promo.kind === 'percent' ? `<small>Up to ${money(promo.cap_cents)}</small>` : ''}</td><td>${money(promo.min_subtotal_cents)}</td><td>${promo.per_account_limit} / account<small>${promo.global_limit} total uses</small></td><td>${esc(dateTime(promo.expires_at))}</td><td>${badge(promo.active ? 'active' : 'inactive')}</td><td><button class="table-link" data-action="edit-promo" data-id="${esc(promo.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : empty('A thoughtful extra, when you’re ready', 'Create percentage or fixed-amount discounts with minimum spend and usage limits.')}</section><p class="muted">Discounts apply to products and option surcharges. Delivery fees are excluded. A promo use is reserved at submission and remains counted after paid cancellations.</p>`;
}
function weekdayFields(name, title, values) {
  return `<h3>${esc(title)}</h3><div class="weekday-options">${DAYS.map((day, i) => `<label><input name="${name}" type="checkbox" value="${i}" ${(values ?? [0, 1, 2, 3, 4, 5, 6]).includes(i) ? 'checked' : ''}>${day}</label>`).join('')}</div>`;
}
function settingsView() {
  const s = state.settings;
  return heading('Shop settings', 'The practical details behind every happy order.') + readonly() + `<form data-form="settings">${formError}<div class="settings-grid"><section class="panel"><h2>Your business</h2>${input('shop_name', 'Shop name', s.shop_name || 'The Little Baker Kitchen', 'text', 'required maxlength="120"')}${input('contact_email', 'Contact email', s.contact_email, 'email', 'required')}${input('contact_phone', 'Contact number', s.contact_phone, 'tel', 'required maxlength="40"')}${input('site_url', 'Ordering website URL', s.site_url || '', 'url', 'placeholder="https://your-preview.example"', 'Use the preview URL during testing. Order emails link to this site.')}</section><section class="panel"><h2>Pickup</h2>${textarea('pickup_address', 'Pickup address', s.pickup_address, '', 'required')}${input('pickup_hours', 'Opening hours', s.pickup_hours, 'text', 'placeholder="Enter your actual pickup hours"')}${textarea('pickup_instructions', 'Pickup instructions', s.pickup_instructions)}</section><section class="panel"><h2>Manual payment</h2>${textarea('payment_instructions', 'Payment methods, account details, and instructions', s.payment_instructions, 'Shown after checkout and in the order email. Full initial payment is required. Customers have 60 minutes to upload proof.', 'required rows="8" placeholder="Enter your real payment account details before opening the shop."')}<p class="help-text">The shop does not process payments. Your team reviews each submitted payment proof.</p></section><section class="panel"><h2>Delivery & reminders</h2>${input('delivery_window', 'Delivery window', s.delivery_window || '9:00 AM – 6:00 PM', 'text', 'required') }<p class="help-text">Customers choose a date only. Arrival may be anytime in this window; morning courier booking is not a promised morning arrival.</p>${input('reminder_time', 'Fulfillment-day reminder time · Manila', s.reminder_time || '08:00', 'time', 'required')}${check('reminders_enabled', 'Send reminders for active paid orders due that day', s.reminders_enabled)}<p class="help-text">Requires a configured email service and scheduler. Saved settings alone do not confirm email delivery.</p></section><section class="panel"><h2>Production schedule</h2>${weekdayFields('production_weekdays', 'Production weekdays', s.production_weekdays)}${textarea('nonproduction_dates', 'Additional non-production dates', (s.nonproduction_dates || []).join('\n'), 'One YYYY-MM-DD date per line. These dates do not count toward product lead times.')}${input('cutoff_time', 'Optional order cutoff · Manila', s.cutoff_time || '', 'time', '', 'Leave blank for no cutoff. An order at or after the cutoff needs one additional eligible full production day.')}<p class="help-text">The order day and fulfillment day do not count. Monday submission + one full Tuesday production day means Wednesday at the earliest.</p></section><section class="panel"><h2>Fulfillment availability</h2>${weekdayFields('fulfillment_weekdays', 'Pickup & delivery weekdays', s.fulfillment_weekdays)}${textarea('blocked_dates', 'Dates closed to new fulfillment bookings', (s.blocked_dates || []).join('\n'), 'One YYYY-MM-DD date per line. Existing bookings stay intact. These dates can still be production days.')}${check('paused', 'Pause new orders', s.paused !== false)}${textarea('pause_message', 'Message while orders are paused', s.pause_message || '', 'Existing order access and eligible proof uploads stay available.')}</section></div><div class="dialog-actions"><button class="button" ${ownerLocked()} type="submit">Save shop settings</button></div></form><section class="panel" style="margin-top:24px"><div class="section-heading"><h2>Delivery zones</h2><button class="button button-secondary" data-action="new-zone" ${owner() ? '' : 'disabled'}>+ Add zone</button></div>${state.zones.length ? state.zones.map(zone => `<div class="zone-card"><div class="section-heading no-margin"><strong>${esc(zone.name)} · ${money(zone.fee_cents)}</strong><span>${badge(zone.active ? 'active' : 'inactive')} <button class="button button-quiet" data-action="edit-zone" data-id="${esc(zone.id)}">Edit</button></span></div><p>${esc(zone.localities.join(' · '))}</p></div>`).join('') : empty('Define where you deliver', 'Add specific city / barangay combinations and their fixed fees. Checkout blocks addresses outside your active covered locations.')}</section>`;
}
function teamView() {
  return heading('Your kitchen team', 'Give the right people access to daily operations.') + readonly() + `<section class="panel"><div class="section-heading"><h2>Team members</h2><button class="button button-secondary" data-action="load-team" ${ownerLocked()}>Refresh team</button></div>${state.staff.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Email</th><th>Role</th></tr></thead><tbody>${state.staff.map(person => `<tr><td>${esc(person.email)}</td><td>${badge(person.role)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Load the team after signing in as an owner. First-owner setup is completed through the protected database setup steps.</p>'}<div class="subsection"><h3>Add or change access</h3><p class="muted">The person must already have a verified customer account. Owners manage the catalog, settings, promo codes, and team. Staff manage orders and daily quantities.</p><form data-form="staff">${formError}<div class="field-row">${input('email', 'Verified account email', '', 'email', 'required')}${select('role', 'Access level', option('staff', 'Staff', 'staff') + option('owner', 'Owner', 'staff') + option('none', 'Remove team access', 'staff'))}</div><button type="submit" class="button" ${ownerLocked()}>Update access</button></form></div></section>`;
}

function openProduct(id) {
  productDraft = clone(state.products.find(p => p.id === id) || { name: '', description: '', category_id: '', price_cents: 0, min_quantity: 1, lead_days: 1, active: false, photos: [], option_groups: [], sort_order: 0 });
  renderProductDialog();
}
function captureProduct() {
  const form = $('[data-form="product"]');
  if (!form) return;
  Object.assign(productDraft, { name: fieldValue(form, 'name'), description: fieldValue(form, 'description'), category_id: fieldValue(form, 'category_id') || null, price_cents: cents(fieldValue(form, 'price')), min_quantity: Number(fieldValue(form, 'min_quantity')), lead_days: Number(fieldValue(form, 'lead_days')), sort_order: Number(fieldValue(form, 'sort_order')), active: fieldChecked(form, 'active') });
  productDraft.option_groups.forEach((group, gi) => { group.label = fieldValue(form, `group_label_${gi}`); group.required_count = Number(fieldValue(form, `group_count_${gi}`)); group.choices.forEach((choice, ci) => { choice.label = fieldValue(form, `choice_label_${gi}_${ci}`); choice.surcharge_cents = cents(fieldValue(form, `choice_price_${gi}_${ci}`)); choice.active = fieldChecked(form, `choice_active_${gi}_${ci}`); }); });
}
function renderProductDialog() {
  const p = productDraft;
  showDialog(p.id ? 'Edit product' : 'Add a little deliciousness', `<form data-form="product">${formError}<div class="field-row">${input('name', 'Product name', p.name, 'text', 'required maxlength="160"')}${select('category_id', 'Category', option('', 'Uncategorized', p.category_id || '') + state.categories.map(c => option(c.id, c.name, p.category_id)).join(''))}</div>${textarea('description', 'Description', p.description, 'Describe the bake, what is included, and anything customers should know.', 'maxlength="6000"')}<div class="field-row three">${input('price', 'Base price · PHP', amount(p.price_cents), 'number', 'required min="0" max="9999999" step="0.01"')}${input('min_quantity', 'Minimum sellable units', p.min_quantity, 'number', 'required min="1" max="9999" step="1"', 'For a cookie box, one unit is one whole box.')}${input('lead_days', 'Full production days', p.lead_days, 'number', 'required min="0" max="365" step="1"')}</div><div class="field-row">${input('sort_order', 'Menu display order', p.sort_order, 'number', 'required step="1"')}${check('active', 'Show this product in the shop', p.active)}</div><div class="subsection"><h3>Product photos</h3><p class="muted">JPEG, PNG, or WebP · up to 5 MB each. The first photo is the menu cover. Product photos are public.</p><div class="photo-list">${p.photos.map((photo, index) => `<div class="photo-tile"><img src="${esc(safeImage(photo))}" alt="Product photo ${index + 1}"><button type="button" class="icon-button" data-action="remove-photo" data-index="${index}" aria-label="Remove photo ${index + 1}">×</button></div>`).join('')}</div>${input('photos', 'Upload photos', '', 'file', `accept="image/jpeg,image/png,image/webp" multiple id="product-photos" ${ownerLocked()}`)}</div><div class="subsection"><div class="section-heading"><h3 class="no-margin">Options & mixed boxes</h3><button type="button" class="button button-secondary" data-action="add-group">+ Add option group</button></div><p class="muted">A required count of 1 creates a single choice. Larger counts let customers build a mix. A box of six requires six selections in total; only the box quantity uses daily stock.</p><div>${p.option_groups.map((group, gi) => `<div class="option-group"><div class="section-heading"><strong>Option group ${gi + 1}</strong><button class="button button-quiet" type="button" data-action="remove-group" data-index="${gi}">Remove group</button></div><div class="field-row">${input(`group_label_${gi}`, 'Group name', group.label, 'text', 'required placeholder="Flavors, size, or packaging"')}${input(`group_count_${gi}`, 'Required selections per unit', group.required_count, 'number', 'required min="1" max="100" step="1"')}</div><div class="option-choices">${group.choices.map((choice, ci) => `<div class="option-choice">${input(`choice_label_${gi}_${ci}`, 'Choice name', choice.label, 'text', 'required')}${input(`choice_price_${gi}_${ci}`, 'Surcharge · PHP / choice', amount(choice.surcharge_cents), 'number', 'required min="0" step="0.01"')}${check(`choice_active_${gi}_${ci}`, 'Available', choice.active !== false)}<button type="button" class="icon-button" data-action="remove-choice" data-group="${gi}" data-index="${ci}" aria-label="Remove choice">×</button></div>`).join('')}</div><button type="button" class="button button-quiet" data-action="add-choice" data-index="${gi}">+ Add choice</button></div>`).join('')}</div></div>${actions(p.id ? 'Save product' : 'Create product')}</form>`);
}
function categoriesDialog() {
  showDialog('Menu categories', `${state.categories.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Category</th><th>Order</th><th></th></tr></thead><tbody>${state.categories.map(c => `<tr><td>${esc(c.name)}</td><td>${c.sort_order}</td><td><button class="table-link" data-action="edit-category" data-id="${esc(c.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Categories help customers browse your menu.</p>'}<div class="dialog-actions"><button class="button button-secondary" data-action="close-dialog">Done</button><button class="button" data-action="new-category" ${owner() ? '' : 'disabled'}>+ Add category</button></div>`);
}
function categoryDialog(id) {
  const c = state.categories.find(item => item.id === id) || { name: '', sort_order: 0 };
  showDialog(c.id ? 'Edit category' : 'Add category', `<form data-form="category" data-id="${esc(c.id || '')}">${formError}${input('name', 'Category name', c.name, 'text', 'required maxlength="100"')}${input('sort_order', 'Display order', c.sort_order, 'number', 'required step="1"')}${c.id ? `<button type="button" class="button button-quiet" data-action="delete-category" data-id="${esc(c.id)}" ${ownerLocked()}>Remove category</button><p class="help-text">Products remain in your catalog and become uncategorized.</p>` : ''}${actions(c.id ? 'Save category' : 'Add category')}</form>`);
}
function zoneDialog(id) {
  const z = state.zones.find(zone => zone.id === id) || { name: '', localities: [], fee_cents: 0, active: true };
  showDialog(z.id ? 'Edit delivery zone' : 'Add delivery zone', `<form data-form="zone" data-id="${esc(z.id || '')}">${formError}<div class="field-row">${input('name', 'Zone name', z.name, 'text', 'required')}${input('fee', 'Fixed delivery fee · PHP', amount(z.fee_cents), 'number', 'required min="0" step="0.01"')}</div>${textarea('localities', 'Covered city / barangay locations', z.localities.join('\n'), 'One complete location per line, for example “City / Barangay”. Customers select one exact covered location and enter their street address separately. Do not list the same location in multiple active zones.', 'required rows="5"')}${check('active', 'Allow delivery to this zone', z.active)}${actions('Save zone')}</form>`);
}
function localTimestamp(value) { return value ? new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''; }
function promoDialog(id) {
  const p = state.promos.find(promo => promo.id === id) || { code: '', kind: 'percent', value: 10, min_subtotal_cents: 0, cap_cents: null, per_account_limit: 1, global_limit: 100, expires_at: '', active: false };
  showDialog(p.id ? 'Edit promo code' : 'Create promo code', `<form data-form="promo" data-id="${esc(p.id || '')}">${formError}<div class="field-row">${input('code', 'Promo code', p.code, 'text', 'required maxlength="40" pattern="[A-Za-z0-9_-]+" autocomplete="off"')}${select('kind', 'Discount type', option('percent', 'Percentage', p.kind) + option('fixed', 'Fixed amount · PHP', p.kind), 'id="promo-kind"')}</div><div class="field-row">${input('value', p.kind === 'percent' ? 'Discount percentage' : 'Discount · PHP', p.kind === 'percent' ? p.value : amount(p.value), 'number', `required min="${p.kind === 'percent' ? '1' : '.01'}" step="${p.kind === 'percent' ? '1' : '.01'}" ${p.kind === 'percent' ? 'max="100"' : ''} id="promo-value"`)}${input('min_subtotal', 'Minimum product subtotal · PHP', amount(p.min_subtotal_cents), 'number', 'required min="0" step="0.01"')}</div><div class="field-row">${input('cap', 'Maximum percentage discount · PHP', p.cap_cents == null ? '' : amount(p.cap_cents), 'number', 'min="0" step="0.01"', 'Optional. Applies only to percentage codes.')}${input('expires_at', 'Expires at · Manila time', localTimestamp(p.expires_at), 'datetime-local', 'required')}</div><div class="field-row">${input('per_account_limit', 'Maximum uses per verified account', p.per_account_limit, 'number', 'required min="1" step="1"')}${input('global_limit', 'Maximum total uses', p.global_limit, 'number', 'required min="1" step="1"')}</div>${check('active', 'Make this code active', p.active)}<p class="muted">Saved orders keep their reserved discount rules if this code is later edited, expires, or is deactivated. Paid cancellations do not restore a use.</p>${actions('Save promo code')}</form>`);
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
  const canProgress = o.payment_status === 'paid' && !CLOSED.has(o.fulfillment_status);
  const statuses = ['confirmed', 'preparing', o.method === 'pickup' ? 'ready_for_pickup' : 'out_for_delivery', 'completed'];
  const address = o.address ? [o.address.line1, o.address.line2, o.address.locality, o.address.postal_code].filter(Boolean).join('\n') : '';
  const notes = o.staff_notes || (o.history || []).filter(event => event.action === 'staff_note').map(event => ({ note: event.reason }));
  showDialog(o.reference, `<div id="print-order"><p class="muted">Placed ${esc(dateTime(o.created_at))} · Revision ${o.revision}</p><div class="order-status-row">${badge(o.payment_status)} ${badge(o.fulfillment_status)} ${o.refund_label ? '<span class="badge refund">Refund label</span>' : ''}</div><div class="order-detail-grid"><section class="detail-section"><h3>Buyer</h3><p><strong>${esc(o.buyer?.name)}</strong>\n${esc(o.buyer?.email)}\n${esc(o.buyer?.phone)}</p>${o.buyer?.social_username ? `<p>${esc(label(o.buyer.social_platform))}: ${esc(o.buyer.social_username)}</p>` : ''}</section><section class="detail-section"><h3>${esc(label(o.method))} · ${esc(humanDate(o.fulfillment_date))}</h3>${o.method === 'delivery' ? `<p><strong>${esc(o.recipient?.name)}</strong>\n${esc(o.recipient?.phone)}\n${esc(address)}</p>` : `<p>${esc(o.pickup_address || state.settings.pickup_address || '')}</p>`}${o.instructions ? `<p>Instructions: ${esc(o.instructions)}</p>` : ''}</section></div>${itemTable(o.items)}${totals(o)}${o.payment_status === 'paid' ? '<p class="muted">Any difference after an order edit is settled directly with the customer. The original payment record and current fulfillment progress are retained.</p>' : ''}<section class="detail-section proof-block"><h3>Initial payment</h3><p>Reference: ${esc(o.payment_reference || 'Not yet submitted')}</p>${o.proof_path ? '<button class="button button-secondary" data-action="view-proof">View private payment proof ↗</button>' : `<p class="muted">${o.payment_status === 'awaiting_payment' && !CLOSED.has(o.fulfillment_status) ? `Proof deadline: ${esc(dateTime(o.payment_deadline))}` : 'No payment proof on this order.'}</p>`}<div id="proof-viewer"></div></section><div class="order-toolbar">${o.payment_status === 'under_review' && !CLOSED.has(o.fulfillment_status) ? '<button class="button" data-action="payment-approve">Approve full payment</button><button class="button button-secondary" data-action="payment-reject">Reject payment</button>' : ''}${canProgress ? `<select id="next-fulfillment" aria-label="Fulfillment status">${options(statuses, o.fulfillment_status, null)}</select><button class="button button-secondary" data-action="fulfill-order">Update progress</button>` : ''}${!CLOSED.has(o.fulfillment_status) ? '<button class="button button-secondary" data-action="edit-order">Edit order</button><button class="button button-quiet" data-action="cancel-order">Cancel order</button>' : '<button class="button button-secondary" data-action="edit-contact">Edit contact details</button>'}<button class="button button-quiet" data-action="refund-label">${o.refund_label ? 'Remove' : 'Apply'} Refund label</button><button class="button button-quiet" data-action="print-order">Print summary</button></div><section class="private-staff"><h3>Private staff notes</h3>${notes.map(note => `<p class="muted">${esc(typeof note === 'string' ? note : note.note || note.text || '')}</p>`).join('')}<form data-form="staff-note">${formError}${textarea('note', 'Add a private note', '', 'Visible only to authorized team members.', 'required maxlength="4000"')}<button type="submit" class="button button-secondary">Save note</button></form></section><section class="subsection history-block"><h3>Order history</h3><ol class="history">${(o.history || []).slice().reverse().map(event => `<li><strong>${esc(label(event.action))}</strong>${event.reason ? ` — ${esc(event.reason)}` : ''}<small>${esc(dateTime(event.at || event.created_at))} · ${esc(typeof event.actor === 'object' ? event.actor.email || event.actor.id || 'Team member' : event.actor || 'System')}</small>${event.before || event.after ? `<details><summary>View recorded changes</summary><div class="change-grid"><div><strong>Before</strong>${historySnapshot(event.before)}</div><div><strong>After</strong>${historySnapshot(event.after)}</div></div></details>` : ''}</li>`).join('') || '<li>Order history is recorded as changes are made.</li>'}</ol></section></div>`);
}
function historySnapshot(value) {
  if (!value) return '<p>—</p>';
  if (typeof value !== 'object') return `<p>${esc(value)}</p>`;
  return `<dl>${Object.entries(value).filter(([key]) => !/token|proof_path|secret/.test(key)).map(([key, val]) => `<dt>${esc(label(key))}</dt><dd>${key.endsWith('_cents') && typeof val === 'number' ? money(val) : Array.isArray(val) && key === 'items' ? val.map(item => `${item.name || item.product_id} × ${item.quantity} · ${money(item.unit_price_cents)}${selectionText(item) ? ` · ${selectionText(item)}` : ''}`).map(esc).join('<br>') : esc(typeof val === 'object' ? Object.entries(val || {}).map(([k, v]) => `${label(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n') : String(val ?? '—'))}</dd>`).join('')}</dl>`;
}
function orderActionDialog(action) {
  const o = activeOrder;
  const content = {
    'approve_payment': ['Approve full initial payment', `Confirm that you have received ${money(o.total_cents)} in full for ${o.reference}. Approval marks payment Paid and fulfillment Confirmed.`, false],
    'reject_payment': ['Reject payment & close order', 'The order will become Rejected and Cancelled. Held product quantities and the unused promo reservation are released. This order will not accept another proof upload.', true],
    'cancel_order': ['Cancel this order', 'Record why this order is being cancelled. Cancellation does not indicate that a refund has been made.', true],
    'set_refund_label': [o.refund_label ? 'Remove Refund label' : 'Apply Refund label', 'This is a manual label for your team. It does not process a refund or change payment, fulfillment, or promo usage.', true]
  }[action];
  showDialog(content[0], `<form data-form="order-action" data-operation="${action}">${formError}<p class="muted">${esc(content[1])}</p>${action === 'approve_payment' ? `<p class="notice">Payment reference: <strong>${esc(o.payment_reference || '—')}</strong>. Check the private proof and your receiving account before approving.</p>` : ''}${content[2] ? textarea('reason', 'Reason / staff record', '', '', 'required maxlength="4000"') : ''}${action === 'cancel_order' && o.payment_status === 'paid' ? check('restore_stock', 'Return the committed units to sellable quantity. Select only if these units can be sold again.', false) : ''}${action === 'cancel_order' && o.payment_status === 'paid' ? '<p class="help-text">Leave unchecked for units already produced or otherwise not available to sell. Paid remains Paid, and a redeemed promo use stays counted.</p>' : ''}<div class="dialog-actions"><button type="button" class="button button-secondary" data-action="back-order">Back</button><button type="submit" class="button ${action === 'reject_payment' || action === 'cancel_order' ? 'button-danger' : ''}">${esc(content[0])}</button></div></form>`);
}

function contactDialog() {
  const o = activeOrder;
  showDialog(`Contact details · ${o.reference}`, `<form data-form="order-contact">${formError}<p class="notice">This order is closed or completed. You can correct contact information and add notes while preserving its items, fulfillment details, and totals.</p><h3>Buyer details</h3><div class="field-row three">${input('buyer_name', 'Name', o.buyer.name, 'text', 'required')}${input('buyer_email', 'Email', o.buyer.email, 'email', 'required')}${input('buyer_phone', 'Contact number', o.buyer.phone, 'tel', 'required')}</div><div class="field-row">${select('social_platform', 'Social platform · optional', option('', 'None', o.buyer.social_platform) + option('facebook', 'Facebook', o.buyer.social_platform) + option('instagram', 'Instagram', o.buyer.social_platform))}${input('social_username', 'Social username · optional', o.buyer.social_username)}</div>${o.method === 'delivery' ? `<h3>Recipient details</h3><div class="field-row">${input('recipient_name', 'Recipient name', o.recipient?.name, 'text', 'required')}${input('recipient_phone', 'Recipient contact number', o.recipient?.phone, 'tel', 'required')}</div>` : ''}${textarea('instructions', 'Recorded fulfillment instructions', o.instructions || '')}${textarea('reason', 'Reason for correction', '', '', 'required maxlength="4000"')}<div class="dialog-actions"><button type="button" class="button button-secondary" data-action="back-order">Back</button><button class="button" type="submit">Save contact correction</button></div></form>`);
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
  editPreviewKey = null; editExpectedQuote = null;
  const d = editDraft;
  const localityOptions = [...new Set([...state.zones.filter(z => z.active).flatMap(z => z.localities), d.address?.locality].filter(Boolean))];
  showDialog(`Edit ${activeOrder.reference}`, `<form data-form="order-edit">${formError}
    <p class="notice">Admin edits bypass product lead times. Changes to items or the date must still fit the affected daily quantities and fulfillment availability. Saved unit prices stay with unchanged configurations.</p>
    <div class="field-row">${input('fulfillment_date', 'Fulfillment date', d.fulfillment_date, 'date', 'required')}${select('method', 'Method', option('pickup', 'Pickup', d.method) + option('delivery', 'Delivery', d.method), 'id="edit-method"')}</div>
    <h3>Items & configurations</h3>${d.items.map(editItemMarkup).join('')}
    <button type="button" class="button button-secondary" data-action="add-edit-item" ${state.products.length ? '' : 'disabled'}>+ Add product</button>
    <div class="subsection"><h3>Buyer details</h3><div class="field-row three">${input('buyer_name', 'Name', d.buyer.name, 'text', 'required')}${input('buyer_email', 'Email', d.buyer.email, 'email', 'required')}${input('buyer_phone', 'Contact number', d.buyer.phone, 'tel', 'required')}</div><div class="field-row">${select('social_platform', 'Social platform · optional', option('', 'None', d.buyer.social_platform) + option('facebook', 'Facebook', d.buyer.social_platform) + option('instagram', 'Instagram', d.buyer.social_platform))}${input('social_username', 'Social username · optional', d.buyer.social_username)}</div></div>
    <div class="subsection" id="edit-delivery" ${d.method === 'pickup' ? 'hidden' : ''}><h3>Delivery recipient & address</h3><div class="field-row">${input('recipient_name', 'Recipient name', d.recipient?.name, 'text', d.method === 'delivery' ? 'required' : '')}${input('recipient_phone', 'Recipient contact number', d.recipient?.phone, 'tel', d.method === 'delivery' ? 'required' : '')}</div>${select('locality', 'Covered city / barangay', option('', 'Select location', d.address?.locality) + localityOptions.map(locality => option(locality, locality, d.address?.locality)).join(''), `id="edit-locality" ${d.method === 'delivery' ? 'required' : ''}`)}${input('line1', 'Street address / building', d.address?.line1, 'text', d.method === 'delivery' ? 'required' : '')}<div class="field-row">${input('line2', 'Unit / floor / additional address', d.address?.line2)}${input('postal_code', 'Postal code', d.address?.postal_code)}</div></div>
    <div class="subsection">${textarea('instructions', 'Fulfillment instructions', d.instructions)}${input('delivery_fee', 'Delivery fee override · PHP', amount(d.method === 'pickup' ? 0 : d.delivery_cents), 'number', 'required min="0" step="0.01" data-edit-value', 'The zone fee is suggested when the location changes. You may adjust it for this order.')}<div id="edit-totals"></div><p class="help-text">The initial estimate uses saved prices and promo rules. Preview the changes to get the server-validated total before saving. Paid-order differences are settled directly with the customer.</p><div id="edit-preview-notice"></div>${textarea('reason', 'Reason for these changes', d.reason, 'The before and after values, staff member, and timestamp are kept in history.', 'required maxlength="4000"')}</div>
    <div class="dialog-actions"><button type="button" class="button button-secondary" data-action="back-order">Back</button><button type="button" class="button button-secondary" data-action="preview-edit">Preview changes</button><button type="submit" class="button" id="save-order-edit" disabled>Save order changes</button></div></form>`);
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
  if (Boolean(editDraft.buyer.social_platform) !== Boolean(editDraft.buyer.social_username)) throw new Error('Enter both a social platform and username, or leave both blank.');
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
function dateRange(from, through) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through) || from > through) throw new Error('Choose a valid date range. The end date must be on or after the start date.');
  const dates = [];
  const current = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${through}T12:00:00Z`);
  for (; current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(current.toISOString().slice(0, 10));
    if (dates.length > 180) throw new Error('Set up to 180 dates at a time.');
  }
  return dates;
}
function validDateList(value, title) {
  const dates = [...new Set(list(value))];
  if (dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) throw new Error(`${title}: use one valid YYYY-MM-DD date per line.`);
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
    case 'close-dialog': closeDialog(); break;
    case 'refresh': await refresh(); toast('Dashboard refreshed.'); break;
    case 'upcoming': state.filters.upcoming = true; state.view = 'orders'; render(); break;
    case 'clear-filters': state.filters = { search: '', payment: '', fulfillment: '', date: '', method: '', refund: '', upcoming: false }; render(); break;
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
    case 'load-team': await loadTeam(); break;
    case 'open-order': await openOrder(id); break;
    case 'back-order': renderOrderDialog(); break;
    case 'payment-approve': orderActionDialog('approve_payment'); break;
    case 'payment-reject': orderActionDialog('reject_payment'); break;
    case 'cancel-order': orderActionDialog('cancel_order'); break;
    case 'refund-label': orderActionDialog('set_refund_label'); break;
    case 'fulfill-order': {
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
    case 'preview-edit': {
      const form = $('[data-form="order-edit"]');
      if (!form.reportValidity()) break;
      captureEdit(); validateEdit();
      const changes = editChanges();
      if (!Object.keys(changes).length) throw new Error('There are no changes to preview.');
      const preview = await api('preview_edit_order', { order_id: activeOrder.id, revision: activeOrder.revision, changes });
      editPreviewKey = stable(changes);
      editExpectedQuote = Object.fromEntries(['items', 'subtotal_cents', 'discount_cents', 'delivery_cents', 'total_cents'].map(key => [key, preview[key]]));
      $('#edit-totals').innerHTML = totals({ ...activeOrder, ...preview });
      $('#edit-preview-notice').innerHTML = '<p class="notice success">Server preview ready. Review the total, then save. Availability is checked again when saving.</p>';
      $('#save-order-edit').disabled = false;
      break;
    }
    case 'add-edit-item': captureEdit(); { const product = state.products.find(p => p.active) || state.products[0]; editDraft.items.push({ product_id: product.id, quantity: product.min_quantity || 1, selections: newSelections(product) }); } renderEditOrder(); break;
    case 'remove-edit-item': captureEdit(); editDraft.items.splice(index, 1); renderEditOrder(); break;
    case 'print-order': window.print(); break;
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
  orders.forEach(o => rows.push([o.reference, dateTime(o.created_at), o.fulfillment_date, label(o.method), label(o.payment_status), label(o.fulfillment_status), o.refund_label ? 'Yes' : 'No', o.buyer?.name, o.buyer?.email, o.buyer?.phone, o.recipient?.name, o.recipient?.phone, [o.address?.line1, o.address?.line2, o.address?.locality, o.address?.postal_code].filter(Boolean).join(', '), o.items.map(item => `${item.name} × ${item.quantity}${selectionText(item) ? ` (${selectionText(item)})` : ''}`).join('; '), amount(o.subtotal_cents), amount(o.discount_cents), amount(o.delivery_cents), amount(o.total_cents), o.paid_amount_cents == null ? '' : amount(o.paid_amount_cents), o.payment_reference, o.instructions]));
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `tlb-orders-${manilaDate()}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', async event => {
  const view = event.target.closest('[data-view]');
  if (view) { state.view = view.dataset.view; render(); if (state.view === 'team' && state.connected && state.role === 'owner') { try { await loadTeam(); } catch (error) { toast(error.message, 'error'); } } return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  event.preventDefault();
  if (button.dataset.busy === 'true') return;
  button.dataset.busy = 'true';
  try { await onAction(button); } catch (error) { toast(error.message || 'Something went wrong. Please try again.', 'error'); } finally { button.dataset.busy = 'false'; }
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target.closest('[data-form="order-edit"]') && target.name !== 'reason') { editPreviewKey = null; editExpectedQuote = null; $('#save-order-edit').disabled = true; $('#edit-preview-notice').innerHTML = ''; }
  if (target.dataset.filter) {
    state.filters[target.dataset.filter] = target.type === 'checkbox' ? target.checked : target.value;
    const orders = filteredOrders();
    $('#order-table').innerHTML = orderTable(orders);
    $('#order-count').textContent = `${orders.length} orders`;
  }
  if (target.hasAttribute('data-edit-value') && editDraft) { captureEdit(); updateEditPreview(); }
});
document.addEventListener('change', async event => {
  const target = event.target;
  try {
    if (target.id === 'inventory-date') { state.inventoryDate = target.value; render(); }
    if (target.id === 'promo-kind') {
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
      if (productDraft.option_groups.some(group => !group.choices.length || !group.choices.some(choice => choice.active))) throw new Error('Every option group needs at least one available choice.');
      await api('save_product', { product: productDraft });
      closeDialog(); await refresh(); toast('Product saved.'); break;
    }
    case 'category': await api('save_category', { category: { ...(form.dataset.id ? { id: form.dataset.id } : {}), name: fieldValue(form, 'name'), sort_order: Number(fieldValue(form, 'sort_order')) } }); closeDialog(); await refresh(); toast('Category saved.'); break;
    case 'delete-category': await api('delete_category', { id: form.dataset.id }); closeDialog(); await refresh(); toast('Category removed. Products are preserved.'); break;
    case 'zone': {
      const localities = [...new Set(list(fieldValue(form, 'localities')))];
      if (!localities.length) throw new Error('Add at least one covered city / barangay location.');
      await api('save_zone', { zone: { ...(form.dataset.id ? { id: form.dataset.id } : {}), name: fieldValue(form, 'name'), localities, fee_cents: cents(fieldValue(form, 'fee')), active: fieldChecked(form, 'active') } });
      closeDialog(); await refresh(); toast('Delivery zone saved.'); break;
    }
    case 'inventory': {
      const dates = dateRange(fieldValue(form, 'start_date'), fieldValue(form, 'end_date'));
      const rows = dates.map(date => ({ product_id: fieldValue(form, 'product_id'), date, capacity: Number(fieldValue(form, 'capacity')), available: fieldValue(form, 'available') === 'yes' }));
      await api('save_inventory', { rows }); state.inventoryDate = dates[0]; await refresh(); toast(`${dates.length} daily allocation${dates.length === 1 ? '' : 's'} saved.`); break;
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
      await api('save_settings', { settings }); await refresh(); toast('Shop settings saved.'); break;
    }
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
      if (Boolean(buyer.social_platform) !== Boolean(buyer.social_username)) throw new Error('Enter both a social platform and username, or leave both blank.');
      const changes = { buyer, instructions: fieldValue(form, 'instructions') };
      if (activeOrder.method === 'delivery') changes.recipient = { ...activeOrder.recipient, name: fieldValue(form, 'recipient_name'), phone: fieldValue(form, 'recipient_phone') };
      await updateActive('edit_order', orderMutationPayload({ changes, reason: fieldValue(form, 'reason') })); break;
    }
    case 'order-edit': {
      captureEdit(); validateEdit();
      const changes = editChanges();
      if (!Object.keys(changes).length) throw new Error('There are no changes to save.');
      if (editPreviewKey !== stable(changes)) throw new Error('Preview these changes and review the updated total before saving.');
      await updateActive('edit_order', orderMutationPayload({ changes, reason: editDraft.reason, expected_quote: editExpectedQuote })); break;
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
    auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') location.replace('account.html?next=manage.html'); });
  } catch (error) {
    $('#shop-status').textContent = 'Dashboard unavailable';
    $('#admin-nav').hidden = true;
    $('#workspace').innerHTML = heading('Dashboard access', 'Your shop information is protected.') + `<section class="panel"><p class="notice danger">${esc(error.message)}</p><p class="muted">Sign in using an authorized team account. For a new installation, follow the first-owner setup steps.</p><div class="row-actions"><a class="button" href="account.html?next=manage.html">Open account</a><a class="button button-secondary" href="docs/SETUP.md" target="_blank" rel="noopener">Setup guide</a></div></section>`;
  }
}
init();
