// Exercise the actual admin page using a local allowlisted fixture only.
// No live products, settings, orders, or notifications are changed.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { dateInManila } from '../../assets/ordering/shop-rules.js';
import { shiftCalendarMonth } from '../../assets/ordering/date-calendar.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const today = dateInManila();
const nextMonth = shiftCalendarMonth(today.slice(0, 7), 1);
const nextDate = `${nextMonth}-05`;
const fixtureKey = 'tlb-delivery-admin-fixture';
const description = 'If one Lalamove motorcycle is not enough,\nwe will contact you to arrange delivery.\n\n<img src=x onerror=alert(1)>';
const fixtures = {
  role: 'owner',
  products: [{ id: 'cake', name: 'Cake', description: 'Local fixture', category_id: null, price_cents: 13000, min_quantity: 1, lead_days: 1, active: true, photos: [], option_groups: [], sort_order: 0 }],
  zones: [{ id: 'qc', name: 'Quezon City', localities: ['Quezon City / Sample Barangay'], fee_cents: 10000, active: true }],
  categories: [], inventory: [], promos: [], orders: [], email_status: [],
  settings: { paused: true, shop_name: 'Local fixture', contact_email: 'owner@example.test', contact_phone: '09170000000', pickup_address: 'Fixture address', payment_instructions: 'No real payments', site_url: 'https://example.test', production_weekdays: [1, 2, 3, 4, 5, 6], fulfillment_weekdays: [0, 1, 2, 3, 4, 5, 6], nonproduction_dates: ['2024-02-29'], blocked_dates: ['2030-12-25'], pickup_blocked_dates: ['2030-12-24'], delivery_blocked_dates: [], delivery_window: '9 AM–6 PM', reminder_time: '08:00', reminders_enabled: false },
};
const realClient = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = realClient.slice(realClient.indexOf('export function money('));
assert.ok(helpers.startsWith('export function money('));
const mockClient = `
export const configured = true;
export const ready = Promise.resolve();
export const auth = {
  getSession: async () => ({ data: { session: { user: { id: 'local-owner', email: 'owner@example.test' } } }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
};
const key = ${JSON.stringify(fixtureKey)};
const initial = ${JSON.stringify(fixtures)};
window.__adminCalls = [];
export async function api(action, payload = {}) {
  const data = JSON.parse(localStorage.getItem(key) || JSON.stringify(initial));
  window.__adminCalls.push({ action, payload: structuredClone(payload) });
  if (action === 'admin_bootstrap') return structuredClone(data);
  if (action === 'save_settings') data.settings = structuredClone(payload.settings);
  else if (action === 'save_product') data.products = data.products.map(p => p.id === payload.product.id ? structuredClone(payload.product) : p);
  else if (action === 'save_zone') data.zones = data.zones.map(z => z.id === payload.zone.id ? structuredClone(payload.zone) : z);
  else throw new Error('Unexpected API action in isolated test: ' + action);
  localStorage.setItem(key, JSON.stringify(data));
  return structuredClone(data);
}
export async function upload() { throw new Error('Uploads are disabled in this isolated test.'); }
export async function websiteVisitorStats() { return {}; }
${helpers}`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/assets/ordering/client.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(mockClient); return; }
    const path = resolve(root, '.' + (name === '/' ? '/manage.html' : name));
    if (!path.startsWith(root + sep)) throw new Error('Invalid path');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const forbidden = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (/supabase|resend|\/auth\/|\/rest\/|\/functions\//.test(url.href)) forbidden.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push('Unexpected browser dialog: ' + dialog.message()); dialog.dismiss(); });
  const calendar = name => page.locator(`[data-date-calendar]:has(textarea[name="${name}"])`);
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), fixtureKey);
  const openSettings = async () => { await page.locator('[data-view="settings"]').first().click(); await calendar('blocked_dates').waitFor(); };
  await page.goto(origin + '/manage.html', { waitUntil: 'networkidle' });
  await openSettings();
  assert.equal(await page.locator('[data-date-calendar]').count(), 3);
  for (const name of ['nonproduction_dates', 'blocked_dates', 'delivery_blocked_dates']) assert.equal(await page.locator(`textarea[name="${name}"]`).isVisible(), false);
  await page.locator('[name="shop_name"]').fill('Unsaved kitchen name');
  await page.locator('[name="pickup_instructions"]').fill('Keep this unsaved instruction.\nSecond line.');
  await calendar('nonproduction_dates').locator(`[data-calendar-date="${today}"]`).click();
  assert.equal(await calendar('nonproduction_dates').locator(`[data-calendar-date="${today}"]`).getAttribute('aria-pressed'), 'true');
  await calendar('blocked_dates').locator('[data-calendar-move="1"]').click();
  await calendar('blocked_dates').locator(`[data-calendar-date="${nextDate}"]`).click();
  assert.equal(await calendar('nonproduction_dates').getAttribute('data-month'), today.slice(0, 7), 'Calendars navigate independently');
  assert.equal(await page.locator('[name="shop_name"]').inputValue(), 'Unsaved kitchen name');
  assert.equal(await page.locator('[name="pickup_instructions"]').inputValue(), 'Keep this unsaved instruction.\nSecond line.');
  assert.equal(await page.evaluate(() => window.__adminCalls.filter(call => call.action === 'save_settings').length), 0, 'Calendar changes must wait for Save shop settings');
  await calendar('delivery_blocked_dates').locator(`[data-calendar-date="${today}"]`).focus();
  await page.keyboard.press('PageDown');
  const keyboardDate = await page.locator(':focus').getAttribute('data-calendar-date');
  assert.equal(keyboardDate.slice(0, 7), nextMonth);
  await page.keyboard.press('Space');
  assert.equal(await page.locator(':focus').getAttribute('aria-pressed'), 'true');
  await calendar('nonproduction_dates').locator('[data-calendar-remove="2024-02-29"]').click();
  await page.locator('[data-form="settings"] button[type="submit"]').click();
  await page.waitForFunction(key => Boolean(localStorage.getItem(key)), fixtureKey);
  let data = await saved();
  assert.deepEqual(data.settings.nonproduction_dates, [today]);
  assert.deepEqual(data.settings.blocked_dates, [nextDate, '2030-12-25'].sort());
  assert.deepEqual(data.settings.delivery_blocked_dates, [keyboardDate]);
  assert.deepEqual(data.settings.pickup_blocked_dates, ['2030-12-24'], 'Unexposed settings must be preserved');
  assert.equal(data.settings.shop_name, 'Unsaved kitchen name');
  await page.reload({ waitUntil: 'networkidle' });
  await openSettings();
  assert.equal(await calendar('nonproduction_dates').locator(`[data-calendar-date="${today}"]`).getAttribute('aria-pressed'), 'true');
  await calendar('delivery_blocked_dates').locator(`[data-calendar-remove="${keyboardDate}"]`).click();
  await page.locator('[data-form="settings"] button[type="submit"]').click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).settings.delivery_blocked_dates.length === 0, fixtureKey);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('[data-date-calendar]').evaluateAll(nodes => nodes.some(node => node.scrollWidth > node.clientWidth + 1)), false, 'Calendars fit on a mobile screen');
  if (process.env.UI_SCREENSHOT_DIR) {
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await calendar('blocked_dates').screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, 'calendar-mobile.png') });
  }

  await page.locator('[data-action="edit-zone"][data-id="qc"]').click();
  assert.equal(await page.locator('[name="description"]').getAttribute('maxlength'), '2000');
  await page.locator('[name="description"]').fill(description);
  await page.locator('[data-form="zone"] button[type="submit"]').click();
  await page.locator('#admin-dialog').waitFor({ state: 'hidden' });
  assert.equal((await saved()).zones[0].description, description);
  assert.equal(await page.locator('.zone-card .zone-description').textContent(), description);
  assert.equal(await page.locator('.zone-card .zone-description img').count(), 0);
  assert.equal(await page.locator('.zone-card .zone-description').evaluate(node => getComputedStyle(node).whiteSpace), 'pre-wrap');
  await page.locator('[data-view="products"]').first().click();
  await page.locator('[data-action="edit-product"][data-id="cake"]').click();
  assert.equal(await page.locator('[name="pickup_only"]').isChecked(), false, 'Legacy products stay deliverable');
  await page.locator('[name="pickup_only"]').check();
  assert.equal(await page.locator('[name="allow_same_day"]').isChecked(), false, 'Legacy products do not allow same-day orders');
  await page.locator('[name="allow_same_day"]').check();
  const savesBeforeConflict = await page.evaluate(() => window.__adminCalls.filter(call => call.action === 'save_product').length);
  await page.locator('[data-form="product"] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('[data-form="product"] .form-error').textContent.includes('Same-day orders require 0 full production days'));
  assert.equal(await page.evaluate(() => window.__adminCalls.filter(call => call.action === 'save_product').length), savesBeforeConflict, 'Conflicting lead time must not be saved');
  assert.equal(await page.locator('[name="lead_days"]').inputValue(), '1', 'Validation does not silently change production days');
  assert.equal(await page.locator('[name="allow_same_day"]').isChecked(), true, 'Validation preserves the chosen option');
  await page.locator('[name="lead_days"]').fill('0');
  await page.locator('[data-action="add-group"]').click();
  assert.equal(await page.locator('[name="pickup_only"]').isChecked(), true, 'Option editor rerender preserves the setting');
  assert.equal(await page.locator('[name="allow_same_day"]').isChecked(), true, 'Option editor rerender preserves same-day eligibility');
  assert.equal(await page.locator('[name="lead_days"]').inputValue(), '0');
  await page.locator('[data-action="remove-group"]').click();
  await page.locator('[data-form="product"] button[type="submit"]').click();
  await page.locator('#admin-dialog').waitFor({ state: 'hidden' });
  assert.equal((await saved()).products[0].pickup_only, true);
  assert.equal((await saved()).products[0].allow_same_day, true);
  assert.equal((await saved()).products[0].lead_days, 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-view="products"]').first().click();
  await page.locator('[data-action="edit-product"][data-id="cake"]').click();
  assert.equal(await page.locator('[name="pickup_only"]').isChecked(), true);
  assert.equal(await page.locator('[name="allow_same_day"]').isChecked(), true, 'Same-day setting persists after reload');
  await page.locator('[name="allow_same_day"]').uncheck();
  await page.locator('[name="lead_days"]').fill('1');
  await page.locator('[name="pickup_only"]').uncheck();
  await page.locator('[data-form="product"] button[type="submit"]').click();
  await page.locator('#admin-dialog').waitFor({ state: 'hidden' });
  assert.equal((await saved()).products[0].pickup_only, false);
  assert.equal((await saved()).products[0].allow_same_day, false);
  assert.equal((await saved()).products[0].lead_days, 1);

  await page.evaluate(key => { const data = JSON.parse(localStorage.getItem(key)); data.role = 'staff'; localStorage.setItem(key, JSON.stringify(data)); }, fixtureKey);
  await page.reload({ waitUntil: 'networkidle' });
  await openSettings();
  assert.equal(await calendar('blocked_dates').locator('[data-calendar-date]').first().isDisabled(), true);
  assert.equal(await page.locator('[data-form="settings"] button[type="submit"]').isDisabled(), true);
  await page.locator('[data-view="products"]').first().click();
  await page.locator('[data-action="edit-product"][data-id="cake"]').click();
  assert.equal(await page.locator('[name="allow_same_day"]').isDisabled(), true, 'Staff cannot change same-day eligibility');
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log('PASS: independent calendar navigation, keyboard selection, saved date removal/persistence, unsaved form preservation, mobile width, owner permissions, product pickup-only and same-day editing, invalid lead-time rejection, and escaped multiline zone descriptions. Local API only.');
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
