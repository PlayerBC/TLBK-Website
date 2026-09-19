// Real storefront, deterministic Philippine date, and local read/quote fixtures.
// Every external request is blocked and every API mutation is rejected.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const fixtureNow = '2026-09-15T02:00:00Z';
const product = { id: 'calendar-nori', name: 'Calendar nori fixture', description: 'Local test only.', price_cents: 13000, min_quantity: 1, lead_days: 0, allow_same_day: true, active: true, photos: [], option_groups: [] };
const otherProduct = { ...product, id: 'calendar-other', name: 'Next-day product fixture', allow_same_day: false };
const inventory = [];
for (let date = new Date('2026-09-15T12:00:00Z'); date <= new Date('2026-11-30T12:00:00Z'); date.setUTCDate(date.getUTCDate() + 1)) {
  for (const item of [product, otherProduct]) inventory.push({ product_id: item.id, date: date.toISOString().slice(0, 10), capacity: 100, remaining: 100, available: true });
}
const catalog = {
  products: [product, otherProduct], categories: [], inventory,
  zones: [{ id: 'local-zone', name: 'Local delivery area', localities: ['Fixture City'], active: true, fee_cents: 10000 }],
  settings: { paused: false, cutoff_time: '12:00', shop_name: 'Calendar fixture', production_weekdays: [0, 1, 2, 3, 4, 5, 6], fulfillment_weekdays: [0, 1, 2, 3, 4, 5, 6], nonproduction_dates: ['2026-09-21'], blocked_dates: ['2026-09-18'], delivery_blocked_dates: ['2026-09-19'], pickup_blocked_dates: ['2026-09-20'], pickup_address: 'Local test kitchen', pickup_hours: '10 AM onwards', pickup_instructions: 'Local test only.', payment_instructions: 'Do not send payment.' },
};
const realClient = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = realClient.slice(realClient.indexOf('export function money('));
assert.ok(helpers.startsWith('export function money('));
const mockClient = `
export const configured = true;
export const ready = Promise.resolve();
export const auth = {
  getSession: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
};
const catalog = ${JSON.stringify(catalog)};
window.__calendarCalls = [];
export async function api(action, payload = {}) {
  window.__calendarCalls.push({ action, payload: structuredClone(payload) });
  if (action === 'catalog') return structuredClone(catalog);
  if (action === 'quote') {
    const items = payload.items.map(item => ({ ...item, name: catalog.products.find(product => product.id === item.product_id).name, unit_price_cents: 13000, line_total_cents: 13000 * item.quantity, selection_labels: [] }));
    const subtotal_cents = items.reduce((sum, item) => sum + item.line_total_cents, 0);
    const delivery_cents = payload.method === 'delivery' ? 10000 : 0;
    return { items, subtotal_cents, delivery_cents, discount_cents: 0, total_cents: subtotal_cents + delivery_cents };
  }
  throw new Error('Forbidden API action in calendar test: ' + action);
}
export async function upload() { throw new Error('Uploads are forbidden in calendar tests.'); }
${helpers}`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/assets/ordering/client.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(mockClient); return; }
    const path = resolve(root, '.' + (name === '/' ? '/shop.html' : name));
    if (!path.startsWith(root + sep)) throw new Error('Invalid path');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' });
  const forbidden = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (/supabase|resend|\/auth\/|\/rest\/|\/functions\//.test(url.href)) forbidden.push(url.href);
    return route.abort();
  });
  await context.addInitScript(instant => {
    const NativeDate = Date;
    window.__calendarNow = instant;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [window.__calendarNow])); }
      static now() { return new NativeDate(window.__calendarNow).getTime(); }
    };
  }, fixtureNow);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push('Unexpected browser dialog: ' + dialog.message()); dialog.dismiss(); });
  const popup = page.locator('#customer-calendar-popup');
  const trigger = page.locator('#fulfillment-date');
  const day = value => page.locator(`[data-customer-date="${value}"]`);
  const previous = page.locator('[data-customer-month="-1"]');
  const next = page.locator('[data-customer-month="1"]');
  const month = page.locator('#customer-calendar-month');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('tlb-checkout-v1') || 'null'));
  const quotes = () => page.evaluate(() => window.__calendarCalls.filter(call => call.action === 'quote'));
  const choose = async value => {
    await trigger.click();
    await day(value).click();
    await popup.waitFor({ state: 'hidden' });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.evaluate(node => node.value), value);
  };

  await page.goto(origin + '/shop.html', { waitUntil: 'networkidle' });
  await trigger.click();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await month.textContent(), 'September 2026');
  assert.equal(await previous.isDisabled(), true);
  assert.equal(await day('2026-09-14').isDisabled(), true);
  assert.equal(await day('2026-09-15').isEnabled(), true, 'Eligible products in stock make today available before the existing cutoff');
  assert.match(await popup.locator('.customer-calendar-help').textContent(), /before 12:00 PM Philippine time/);
  assert.equal(await day('2026-09-16').isEnabled(), true, 'Tomorrow follows Philippine time even on a US browser');
  assert.equal(await day('2026-09-18').isDisabled(), true, 'All-bookings closure disables this date');
  assert.equal(await day('2026-09-19').isEnabled(), true, 'Delivery closure does not close pickup');
  assert.equal(await day('2026-09-20').isDisabled(), true, 'Pickup closure follows the selected method');
  assert.equal(await day('2026-09-21').isEnabled(), true, 'A non-production day alone is not a fulfillment closure');
  assert.equal(await popup.locator('[data-customer-date^="2026-08"]').count(), 0);

  await next.click();
  assert.equal(await month.textContent(), 'October 2026');
  assert.equal(await previous.isEnabled(), true);
  assert.equal(await next.isEnabled(), true);
  await next.click();
  assert.equal(await month.textContent(), 'November 2026');
  assert.equal(await next.isDisabled(), true, 'Navigation ends at the second following month');
  assert.equal(await popup.locator('[data-customer-date^="2026-12"]').count(), 0);
  for (const key of ['ArrowRight', 'PageDown', 'Shift+PageDown']) {
    await day('2026-11-30').focus();
    await page.keyboard.press(key);
    assert.equal(await month.textContent(), 'November 2026');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.customerDate), '2026-11-30', key + ' cannot escape the maximum date');
  }
  await page.locator('[data-customer-current]').click();
  for (const key of ['ArrowLeft', 'PageUp', 'Shift+PageUp']) {
    await day('2026-09-15').focus();
    await page.keyboard.press(key);
    assert.equal(await month.textContent(), 'September 2026');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.customerDate), '2026-09-15', key + ' cannot focus a past date');
  }
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.id === 'fulfillment-date');

  await page.locator('[data-method="delivery"]').click();
  await trigger.click();
  assert.equal(await day('2026-09-19').isDisabled(), true);
  assert.equal(await day('2026-09-20').isEnabled(), true, 'Pickup closure does not close delivery');
  assert.equal(await day('2026-09-18').isDisabled(), true);
  await day('2026-09-22').click();
  await popup.waitFor({ state: 'hidden' });
  await page.locator('[data-method="pickup"]').click();
  assert.equal(await popup.count(), 1, 'Changing methods must not leave duplicate dialogs');
  await trigger.click();
  assert.equal(await day('2026-09-22').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-customer-clear]').click();
  await popup.waitFor({ state: 'hidden' });
  assert.equal((await saved()).fulfillment_date, '');
  assert.equal(await trigger.evaluate(node => node.value), '');
  await choose('2026-09-22');

  // Date selection remains attached to the basket and buyer's saved details.
  await page.locator('[data-product="calendar-nori"]').click();
  await page.locator('#add-to-cart').click();
  await page.locator('#checkout-button').click();
  await page.locator('[name="buyer_name"]').fill('Calendar Buyer');
  await page.locator('[name="buyer_email"]').fill('calendar@example.test');
  await page.locator('[name="buyer_phone"]').fill('09170000000');
  await page.locator('[name="social_platform"]').selectOption('na');
  await page.locator('#back-to-menu').click();
  await choose('2026-09-23');
  assert.equal((await saved()).items.length, 1);
  await page.locator('#checkout-button').click();
  assert.equal(await page.locator('[name="buyer_name"]').inputValue(), 'Calendar Buyer');
  await page.locator('#review-order').click();
  await page.locator('#place-order').waitFor();
  assert.equal((await quotes()).at(-1).payload.fulfillment_date, '2026-09-23');
  assert.equal((await quotes()).at(-1).payload.method, 'pickup');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await trigger.evaluate(node => node.value), '2026-09-23');
  assert.equal((await saved()).items.length, 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  assert.equal(await day('2026-09-23').getAttribute('aria-pressed'), 'true');
  const bounds = await popup.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Calendar fits the mobile viewport');
  assert.equal(await popup.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'Calendar has no horizontal overflow');
  if (process.env.UI_SCREENSHOT_DIR) {
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, 'customer-calendar-mobile.png'), fullPage: true });
  }
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });

  // Old storage cannot resurrect a date outside the customer booking horizon.
  await page.evaluate(() => {
    const previous = JSON.parse(localStorage.getItem('tlb-checkout-v1'));
    localStorage.setItem('tlb-checkout-v1', JSON.stringify({ ...previous, fulfillment_date: '2040-01-01', saved_at: Date.now() }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('#checkout-button').isDisabled(), true);
  assert.equal(await trigger.getAttribute('aria-invalid'), 'true');
  await trigger.click();
  assert.equal(await month.textContent(), 'September 2026', 'An invalid restored date opens the current month');
  assert.equal(await previous.isDisabled(), true);
  assert.match(await popup.locator('.customer-calendar-error').textContent(), /current month|next two months|2026-11-30/);
  // Eligibility follows the basket; a mixed basket cannot book today.
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.removeItem('tlb-checkout-v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await choose('2026-09-16');
  await page.locator('[data-product="calendar-nori"]').click();
  await page.locator('#add-to-cart').click();
  await trigger.click();
  assert.equal(await day('2026-09-15').isEnabled(), true, 'A basket containing only same-day products can select today');
  await page.keyboard.press('Escape');
  await page.locator('[data-product="calendar-other"]').click();
  await page.locator('#add-to-cart').click();
  await trigger.click();
  assert.equal(await day('2026-09-15').isDisabled(), true, 'One ineligible product blocks same-day for the whole basket');
  await page.keyboard.press('Escape');
  await page.locator('[data-remove="1"]').click();
  await trigger.click();
  assert.equal(await day('2026-09-15').isEnabled(), true, 'Removing the ineligible product restores today');
  await page.keyboard.press('Escape');
  await choose('2026-09-15');
  assert.equal((await saved()).fulfillment_date, '2026-09-15');

  // A popup opened before cutoff must reject an activation at the cutoff itself.
  await trigger.click();
  await page.locator('[data-customer-clear]').click();
  await trigger.click();
  assert.equal(await day('2026-09-15').isEnabled(), true);
  await page.evaluate(() => { window.__calendarNow = '2026-09-15T04:00:00Z'; });
  await day('2026-09-15').click();
  assert.equal(await popup.isVisible(), true, 'Rejected date does not close the popup');
  assert.equal(await day('2026-09-15').isDisabled(), true);
  assert.equal((await saved()).fulfillment_date, '', 'Rejected date is never saved');
  assert.match(await popup.locator('.customer-calendar-help').textContent(), /cutoff.*12:00 PM.*has passed/i);
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.__calendarCalls.filter(call => !['catalog', 'quote'].includes(call.action))), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, [], 'Production services must never be contacted');
  console.log('PASS: calendar same-day eligibility, mixed baskets, exact cutoff, past-date and month bounds, Philippine timezone, method closures, keyboard bounds, clear/reopen, basket and buyer persistence, review date, stale dates, mobile fit, no API mutations or external service requests.');
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
