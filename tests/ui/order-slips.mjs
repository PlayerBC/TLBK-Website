// Real dashboard/print integration with local fixtures; every external request is blocked.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.PRINT_TEST_OUTPUT || join(root, 'tests/artifacts/order-slips'));
await mkdir(output, { recursive: true });
const origin = 'https://order-slips.test', key = 'order-slip-fixture';
const item = (name, quantity, price, variation, product_id = 'nori') => ({ name, quantity, unit_price_cents: price,
  line_total_cents: quantity * price, product_id, selection_labels: [variation] });
const small = {
  id: 'order-1', reference: 'SAMPLE-DELIVERY', revision: 3, created_at: '2026-09-19T02:00:00Z',
  fulfillment_date: '2026-09-23', method: 'delivery', payment_status: 'paid', fulfillment_status: 'confirmed',
  buyer: { name: 'Alex Cruz', phone: '09XX XXX 1234', email: 'alex@example.test', social_platform: 'instagram', social_username: '@alex.sample' },
  recipient: { name: 'Jamie Cruz', phone: '09XX XXX 5678' },
  address: { line1: 'Unit 3B, 123 Sample Street', line2: 'Brgy. Sample', locality: 'Quezon City, Metro Manila', postal_code: '1100' },
  delivery_window: '9 AM - 6 PM', pickup_address: 'The Little Baker Kitchen\nCollection at the kitchen', pickup_hours: '10 AM - 5 PM', pickup_instructions: 'CUSTOMER-PICKUP-GUIDE: bring ID and message us before you arrive.',
  instructions: 'Pack the flavors separately.\nRing the bell and call on arrival.',
  items: [item('Krisp Nori Pouch', 3, 13000, 'Flavor: Original'), item('Krisp Nori Pouch', 2, 13000, 'Flavor: Cheese')],
  subtotal_cents: 65000, discount_cents: 6500, delivery_cents: 10000, total_cents: 68500,
  promo_snapshot: { code: 'DEMO10' }, paid_amount_cents: 162400,
  payment_reference: 'PRIVATE-PAYMENT-REFERENCE', proof_path: 'PRIVATE-PROOF',
  staff_notes: ['PRIVATE-STAFF-NOTE'], history: [{ action: 'staff_note', reason: 'PRIVATE-AUDIT-HISTORY', at: '2026-09-19T02:00:00Z' }],
};
const large = { ...small, reference: 'SAMPLE-LARGE', method: 'pickup',
  instructions: 'Cake: Happy Birthday, Mia!\nKeep chilled. Box separately.\nGroup pouches by flavor.',
  items: [item('Ube Cake', 1, 225000, '8-inch | Ube halaya filling', 'cake'),
    ...['Original', 'Cheese', 'BBQ', 'Sour Cream', 'White Cheddar'].map((flavor, i) => item('Krisp Nori Pouch', [4,3,3,2,2][i], 13000, `Flavor: ${flavor}`))],
  subtotal_cents: 407000, discount_cents: 40700, delivery_cents: 0, total_cents: 366300,
};
const products = [{ id: 'nori', name: 'Renamed catalog pouch', price_cents: 99900, photos: [`${origin}/photos/nori.webp`], option_groups: [] },
  { id: 'cake', name: 'New catalog cake', price_cents: 999999, photos: [`${origin}/photos/ube-cake.jpg`], option_groups: [] }];
const settings = { shop_name: 'The Little Baker Kitchen', paused: false, pickup_address: 'NEW ADDRESS - NOT THE SNAPSHOT', pickup_hours: 'NEW HOURS',
  pickup_instructions: 'NEW PICKUP INSTRUCTIONS', delivery_window: 'NEW DELIVERY HOURS', production_weekdays: [0,1,2,3,4,5,6], fulfillment_weekdays: [0,1,2,3,4,5,6] };
const client = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = client.slice(client.indexOf('export function money('));
const mock = `export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'local-owner'}}}}),onAuthStateChange:()=>{}};
export async function api(action,payload={}){window.apiCalls??=[];window.apiCalls.push(action);const fixture=JSON.parse(localStorage.getItem('${key}'));
const orders=fixture.orders||[fixture.order];
if(action==='admin_bootstrap')return {role:fixture.role||'owner',categories:[],inventory:[],promos:[],zones:[],staff:[],email_status:[],settings:fixture.settings,products:fixture.products,orders};
if(action==='get_order'){window.loadedOrderIds??=[];window.loadedOrderIds.push(payload.order_id);if(payload.order_id===fixture.failOrderId)throw Error('The selected order is no longer available.');return fixture.freshOrders?.[payload.order_id]||orders.find(order=>order.id===payload.order_id)}throw Error('Unexpected API '+action)}
export async function upload(){throw Error('Unexpected upload')} export async function websiteVisitorStats(){return {}} ${helpers}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const results = { checks: [], errors: [] };
const check = (name, pass) => { results.checks.push({ name, pass: Boolean(pass) }); assert.ok(pass, name); };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
let imageDelay = 0, rejectStyle = false;
context.on('page', page => page.on('pageerror', error => results.errors.push(error.message)));
await context.addInitScript(() => {
  window.print = () => {
    window.printCalls = (window.printCalls || 0) + 1;
    window.photosReadyAtPrint = [...document.images].every(img => img.complete && img.naturalWidth > 0);
  };
  const original = window.open;
  window.open = function(...args) {
    if (window.blockPopups) return null;
    return original.apply(this, args);
  };
});
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/assets/ordering/client.js') return route.fulfill({ contentType: 'text/javascript', body: mock });
  if (url.pathname === '/assets/ordering/order-slips.css' && rejectStyle) return route.fulfill({ status: 503, body: '' });
  if (['/assets/ordering/traffic.js', '/assets/ordering/newsletter.js'].includes(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: '' });
  if (url.pathname.startsWith('/photos/')) {
    if (imageDelay) await new Promise(resolve => setTimeout(resolve, imageDelay));
    if (url.pathname.endsWith('missing.jpg')) return route.fulfill({ status: 404, body: '' });
    if (process.env.PRINT_TEST_IMAGE_DIR) return route.fulfill({ contentType: mime[extname(url.pathname)], body: await readFile(join(process.env.PRINT_TEST_IMAGE_DIR, url.pathname.split('/').at(-1))) });
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#8c6997"/><circle cx="60" cy="60" r="35" fill="#eadca8"/></svg>' });
  }
  try { return await route.fulfill({ contentType: mime[extname(url.pathname)] || 'application/octet-stream', body: await readFile(join(root, url.pathname)) }); }
  catch { return route.fulfill({ status: 404, body: 'Not found' }); }
});
const page = await context.newPage();
async function openOrder(order, options = {}) {
  await page.goto(`${origin}/manage.html`);
  await page.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), { key, fixture: { order, products, settings, ...options } });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-view="orders"]').click();
  await page.locator('[data-action="open-order"]').first().click();
  await page.locator('[data-action="print-order"]').waitFor();
}
async function print(order, options = {}) {
  await openOrder(order, options);
  const popupPromise = page.waitForEvent('popup');
  await page.locator('[data-action="print-order"]').click();
  const popup = await popupPromise;
  await popup.waitForFunction(() => !document.querySelector('.print-slips')?.disabled || /cannot fit|could not load/.test(document.querySelector('[role="status"]')?.textContent));
  if (await popup.locator('.print-slips').isDisabled()) throw new Error(await popup.locator('[role="status"]').innerText());
  await popup.locator('.print-slips').click();
  return popup;
}
async function noOverflow(popup) {
  return popup.evaluate(() => [...document.querySelectorAll('.print-sheet,.slip,.slip-left,.slip-details,.slip-header,.slip-footer')]
    .every(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1));
}
try {
  // Establish the origin before the first fixture is saved. Ignore the empty-fixture
  // bootstrap; the next reload uses only the explicit fixture below.
  await page.goto(`${origin}/manage.html`);
  let popup = await print(small);
  check('Print summary opens one compact slip for a two-line delivery order', await popup.locator('.slip').count() === 1);
  const body = await popup.locator('#slips').innerText();
  check('Saved buyer, social, recipient and all delivery address fields print', ['Alex Cruz', '@alex.sample', 'Jamie Cruz', '09XX XXX 5678', 'Unit 3B', 'Brgy. Sample', 'Quezon City', '1100'].every(value => body.includes(value)));
  check('Saved labels/prices are preserved despite changed catalog data', body.includes('Krisp Nori Pouch') && body.includes('₱130.00') && !body.includes('Renamed catalog') && !body.includes('₱999.00'));
  check('Payment breakdown uses the current saved total and promo', ['₱650.00', '₱65.00', '₱100.00', '₱685.00', 'DEMO10'].every(value => body.includes(value)));
  check('Private notes, history, proof and original approved payment stay out of the print document', !/PRIVATE-|Original approved|1,624/.test(await popup.content()));
  check('Product photos finish loading before the native print dialog opens', await popup.evaluate(() => window.photosReadyAtPrint));
  check('Small slip has no clipped content', await noOverflow(popup));
  await popup.locator('.slip').screenshot({ path: join(output, 'delivery-slip.png') });
  await popup.pdf({ path: join(output, 'delivery-slip.pdf'), preferCSSPageSize: true, printBackground: true });
  await popup.locator('.print-slips').click();
  check('Preview can reopen printing after cancellation', await popup.evaluate(() => window.printCalls === 2));
  await popup.close();

  popup = await print(large, { role: 'staff' });
  check('Staff can print a six-line pickup order on two slips', await popup.locator('.slip').count() === 2);
  check('Each item appears once, in the saved order', await popup.locator('.slip-item[data-continued="false"]').count() === 6 && (await popup.locator('.slip-item').evaluateAll(cards => cards.map(card => Number(card.dataset.itemIndex)))).join() === '0,1,2,3,4,5');
  check('Continuation slips repeat reference and buyer', await popup.locator('.slip-reference').count() === 2 && await popup.locator('.slip-buyer-name').count() === 2 && (await popup.locator('.slip-number').allTextContents()).join() === 'Slip 1 of 2,Slip 2 of 2');
  check('The complete payment breakdown appears only on the final slip', await popup.locator('.slip-payment').count() === 1 && await popup.locator('.slip').last().locator('.slip-total').innerText() === 'Order total\n₱3,663.00');
  check('Pickup preserves its saved location/hours but excludes general customer pickup instructions', (await popup.locator('#slips').innerText()).includes('Collection at the kitchen') && !/Unit 3B|NEW ADDRESS|NEW HOURS|NEW PICKUP|CUSTOMER-PICKUP-GUIDE|Pickup instructions/.test(await popup.locator('#slips').innerText()));
  check('Customer-entered preparation instructions still print', (await popup.locator('#slips').innerText()).includes('Keep chilled. Box separately.'));
  check('Large order has no clipped content', await noOverflow(popup));
  for (let i = 0; i < 2; i++) await popup.locator('.slip').nth(i).screenshot({ path: join(output, `large-slip-${i + 1}.png`) });
  await popup.pdf({ path: join(output, 'large-slips.pdf'), preferCSSPageSize: true, printBackground: true });
  await popup.setViewportSize({ width: 390, height: 844 });
  await popup.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
  check('Mobile preview fits the viewport', await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await popup.screenshot({ path: join(output, 'mobile-preview.png'), fullPage: true });
  await popup.close();

  const longNote = 'Keep the cake chilled; label every pouch and call the customer before collection. '.repeat(25).trim();
  const longOptions = 'Mixed box: chocolate × 2, vanilla × 2, ube × 2. '.repeat(50).trim();
  popup = await print({ ...large, instructions: longNote, items: [{ ...large.items[0], selection_labels: [longOptions] }, ...large.items.slice(1)] });
  const chunks = await popup.locator('.slip-item[data-item-index="0"] .slip-variation').allTextContents();
  const instructionChunks = await popup.locator('.slip-detail').evaluateAll(sections => sections.filter(section => section.querySelector('h2').textContent.startsWith('Instructions')).map(section => section.querySelector('p').textContent));
  check('Extra-long mixed-box selections continue without losing characters', chunks.join('') === longOptions && chunks.length > 1);
  check('Long instructions continue without losing characters', instructionChunks.join('') === longNote && instructionChunks.length > 1);
  check('Long text does not clip and totals remain on the last slip', await noOverflow(popup) && await popup.locator('.slip').last().locator('.slip-payment').count() === 1);
  await popup.pdf({ path: join(output, 'long-details.pdf'), preferCSSPageSize: true, printBackground: true });
  await popup.close();

  const many = Array.from({ length: 30 }, (_, i) => item(`Product ${i + 1}`, 1, 13000, `Variation ${i + 1}`));
  popup = await print({ ...small, items: many, subtotal_cents: 390000, discount_cents: 0, total_cents: 400000, promo_snapshot: null });
  check('Thirty product lines paginate completely with no clipping or duplication', await popup.locator('.slip-item[data-continued="false"]').count() === 30 && await noOverflow(popup));
  await popup.close();

  const malicious = '<img src=x onerror="window.INJECTED=1">';
  popup = await print({ ...small, buyer: { ...small.buyer, name: malicious }, instructions: malicious,
    items: [{ ...small.items[0], name: malicious }, { ...small.items[1], product_id: 'gone' }] },
    { products: [{ ...products[0], photos: ['javascript:window.INJECTED=1'] }] });
  check('Customer text is escaped and unsafe or deleted product photos use a fallback', !await popup.evaluate(() => window.INJECTED) && await popup.locator('.slip-photo img').count() === 0 && (await popup.locator('.slip-photo').allTextContents()).every(value => value === 'No photo'));
  await popup.close();
  popup = await print(small, { products: [{ ...products[0], photos: [`${origin}/photos/missing.jpg`] }] });
  check('Failed product images have a printable fallback', (await popup.locator('.slip-photo').allTextContents()).every(value => value === 'Photo unavailable'));
  await popup.close();

  imageDelay = 700;
  popup = await print(small);
  check('Slow photos do not race the print dialog', await popup.evaluate(() => window.photosReadyAtPrint));
  imageDelay = 0;
  await popup.close();
  popup = await print({ ...small, refund_label: true, fulfillment_status: 'cancelled', payment_status: 'under_review' });
  check('Cancelled/refunded/unapproved orders print their actual status', (await popup.locator('.slip-state').innerText()).includes('Refund label | Cancelled | Payment: Under review'));
  await popup.close();
  popup = await print({ ...small, buyer: {}, recipient: {}, address: {}, items: [], instructions: '' });
  check('Older incomplete orders still produce a printable summary', await popup.locator('.slip-payment').count() === 1 && await noOverflow(popup));
  await popup.close();

  const batch = [small, { ...large, id: 'order-2' }, { ...small, id: 'order-3', reference: 'SAMPLE-PICKUP', method: 'pickup', buyer: { ...small.buyer, name: 'Sam Reyes' }, instructions: 'Pack the flavors separately.', delivery_cents: 0, total_cents: 58500 }];
  async function ordersList(orders, extras = {}) {
    await page.evaluate(({key,fixture}) => localStorage.setItem(key, JSON.stringify(fixture)), { key, fixture: { orders, products, settings, ...extras } });
    await page.goto(`${origin}/manage.html`, { waitUntil: 'networkidle' });
    await page.locator('[data-view="orders"]').click();
  }
  async function selectedPreview() {
    const pending = page.waitForEvent('popup');
    await page.locator('[data-action="print-selected-orders"]').click();
    const preview = await pending;
    await preview.waitForFunction(() => !document.querySelector('.print-slips')?.disabled || /cannot fit|could not load|no longer available/.test(document.querySelector('[role="status"]')?.textContent));
    return preview;
  }
  await ordersList(batch, { role: 'staff' });
  check('Batch printing starts with no selection and a disabled print button', await page.locator('[data-action="print-selected-orders"]').isDisabled());
  await page.locator('[data-print-order="order-1"]').check();
  check('One selection updates the count and select-all mixed state', await page.locator('#print-selection-count').innerText() === '1 selected' && await page.locator('#select-print-orders').evaluate(el => el.indeterminate));
  await page.locator('#select-print-orders').check();
  check('Select all shown orders selects the full current result', await page.locator('[data-print-order]:checked').count() === 3);
  popup = await selectedPreview();
  check('Batch preview allows paper choice before opening the print dialog', !await popup.evaluate(() => window.printCalls) && !await popup.locator('#paper-size').isDisabled());
  check('Three selected orders including continuations share one four-slip sheet', await popup.locator('.print-sheet').count() === 1 && await popup.locator('.slip').count() === 4 && await popup.locator('.slip-payment').count() === 3);
  const dimensions = await popup.locator('.slip').first().evaluate(el => ({ width: el.offsetWidth * 25.4 / 96, height: el.offsetHeight * 25.4 / 96 }));
  check('Every slip is five inches wide and four inches high', Math.abs(dimensions.width - 127) < .3 && Math.abs(dimensions.height - 101.6) < .3);
  await popup.emulateMedia({ media: 'print' });
  const placements = await popup.locator('.print-sheet').first().evaluate(sheet => {
    const paper = sheet.getBoundingClientRect();
    return [...sheet.children].map(card => { const rect = card.getBoundingClientRect(); return { x: (rect.x - paper.x) * 25.4 / 96, y: (rect.y - paper.y) * 25.4 / 96 }; });
  });
  check('Slips fill from the top-left in two rows without centering each order', Math.abs(placements[0].x - 3) < .2 && Math.abs(placements[0].y - 3) < .2 && Math.abs(placements[1].x - 130.5) < .2 && Math.abs(placements[2].y - 105.1) < .2);
  check('The printed sheet and all its slips have no overflow', await noOverflow(popup));
  await popup.locator('.print-sheet').screenshot({ path: join(output, 'batch-a4-sheet.png') });
  await popup.pdf({ path: join(output, 'batch-a4.pdf'), preferCSSPageSize: true, printBackground: true });
  await popup.emulateMedia({ media: null });
  await popup.locator('#paper-size').selectOption('letter');
  check('Letter paper keeps four slips at the same physical size', await popup.locator('.print-sheet[data-paper="letter"]').count() === 1 && await popup.locator('.slip').count() === 4);
  await popup.pdf({ path: join(output, 'batch-letter.pdf'), preferCSSPageSize: true, printBackground: true });
  await popup.locator('.print-slips').click();
  check('One print action includes the complete batch after photos are ready', await popup.evaluate(() => window.printCalls === 1 && window.photosReadyAtPrint));
  await popup.close();
  check('Batch printing retrieves each selected saved order', (await page.evaluate(() => window.loadedOrderIds)).join() === 'order-1,order-2,order-3');
  await page.locator('[data-action="clear-print-selection"]').click();
  check('Clear selection resets checkboxes and print count', await page.locator('[data-print-order]:checked').count() === 0 && await page.locator('[data-action="print-selected-orders"]').isDisabled());
  await page.locator('#select-print-orders').check();
  await page.locator('#order-search').fill('Sam Reyes');
  check('Filtering clears hidden selections', await page.locator('[data-print-order]').count() === 1 && await page.locator('[data-print-order]:checked').count() === 0);
  await page.locator('#select-print-orders').check();
  popup = await selectedPreview();
  check('Select all while filtered prints only matching orders', (await popup.locator('.slip-reference').allTextContents()).every(value => value === 'SAMPLE-PICKUP'));
  check('Paper preference is remembered for the next print job', await popup.locator('#paper-size').inputValue() === 'letter');
  await popup.close();

  const five = Array.from({length:5}, (_, i) => ({...small, id:`batch-${i}`, reference:`BATCH-${i+1}`}));
  await ordersList(five, { freshOrders: { 'batch-0': { ...five[0], instructions: 'LATEST SAVED PREPARATION NOTE' } } });
  await page.locator('#select-print-orders').check();
  popup = await selectedPreview();
  check('Five orders fill four slots then begin the next sheet', (await popup.locator('.print-sheet').evaluateAll(sheets => sheets.map(sheet => sheet.children.length))).join() === '4,1');
  check('Batch uses fresh order details rather than stale list summaries', (await popup.locator('#slips').innerText()).includes('LATEST SAVED PREPARATION NOTE'));
  await popup.locator('#paper-size').selectOption('a4');
  await popup.pdf({ path: join(output, 'five-orders-a4.pdf'), preferCSSPageSize: true, printBackground: true });
  await popup.setViewportSize({ width: 390, height: 844 });
  await popup.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
  check('Multi-sheet batch preview fits mobile screens', await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await popup.close();
  await ordersList(batch, { failOrderId: 'order-2' });
  await page.locator('#select-print-orders').check();
  popup = await selectedPreview();
  check('An unavailable selected order stops the whole print job without a partial batch', await popup.locator('.slip').count() === 0 && await popup.locator('.print-slips').isDisabled() && (await popup.locator('[role="status"]').innerText()).includes('no longer available'));
  await popup.close();

  await openOrder(small);
  await page.evaluate(() => { window.blockPopups = true; });
  await page.locator('[data-action="print-order"]').click();
  check('Blocked popups show an actionable retry message', await page.locator('#toast-region').innerText().then(value => value.includes('Allow pop-ups')));
  await page.evaluate(() => { window.blockPopups = false; });
  rejectStyle = true;
  const failedPopup = page.waitForEvent('popup');
  await page.locator('[data-action="print-order"]').click();
  popup = await failedPopup;
  await popup.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('could not load'));
  check('A missing print stylesheet cannot produce an unformatted print', await popup.locator('.print-slips').isDisabled() && !await popup.evaluate(() => window.printCalls));
  rejectStyle = false;
  await popup.close();
  check('Printing performs no order or product mutations', (await page.evaluate(() => window.apiCalls)).every(action => ['admin_bootstrap', 'get_order'].includes(action)));
  check('No browser JavaScript errors', results.errors.length === 0);
} catch (error) { results.error = error.stack; process.exitCode = 1; }
finally { await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results)); await browser.close(); }
