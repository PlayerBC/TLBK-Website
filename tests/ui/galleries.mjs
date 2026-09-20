// Local browser fixtures only: production auth, uploads and data are never used.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..'), origin = 'https://gallery.test';
const output = resolve(process.env.GALLERY_TEST_OUTPUT || join(root, 'test-results/galleries'));
await mkdir(output, { recursive: true });
const client = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = client.slice(client.indexOf('export function money('));
const bootstrap = { role: 'owner', products: [], categories: [], orders: [], inventory: [], promos: [], zones: [], staff: [], email_status: [], settings: { paused: false } };
const photos = Array.from({ length: 63 }, (_, index) => ({ id: `photo-${index}`, gallery: 'custom-orders', title: index ? '' : 'Pikachu cake', description: '', category: 'Characters', keywords: ['Pikachu', 'Pokémon'], photo_url: `${origin}/photos/${index}.webp`, revision: 1, published: true }));
const calls = [], errors = [];
let enabled = true, uploadInfo, failMore = false, delayQuery = false;
function response(action, payload) {
  calls.push({ action, payload });
  if (action === 'browse' || action === 'admin_list') {
    const q = (payload.query || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const matching = photos.filter(p => p.gallery === payload.gallery && (action !== 'browse' || p.published) && (!payload.category || p.category === payload.category) && (!q || [p.title, p.category, ...p.keywords].join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q)));
    return { enabled, revision: 1, categories: payload.gallery === 'pastries' ? ['Tiramisu', 'Nori Chips', 'Cookies'] : ['Characters'], total: matching.length, items: matching.slice(payload.offset || 0, (payload.offset || 0) + 24).map(p => action === 'browse' ? { id: p.id, photo_url: p.photo_url, category: p.category, title: p.title, description: p.description } : p) };
  }
  if (action === 'save') {
    const photo = { ...payload.photo, gallery: payload.gallery, id: payload.photo.id || `added-${photos.length}`, revision: (payload.photo.revision || 0) + 1 };
    const i = photos.findIndex(p => p.id === photo.id); if (i < 0) photos.push(photo); else photos[i] = photo; return photo;
  }
  if (action === 'delete') { photos.splice(photos.findIndex(p => p.id === payload.id), 1); return { deleted: true }; }
  if (action === 'set_enabled') { enabled = payload.enabled; return { enabled, revision: 2 }; }
  if (action === 'import') {
    let added = 0, skipped = 0;
    for (const photo of payload.photos) {
      if (photos.some(p => p.gallery === payload.gallery && p.legacy_id === photo.legacy_id)) skipped++;
      else { photos.push({ ...photo, id: `imported-${photo.legacy_id}`, gallery: payload.gallery, revision: 1 }); added++; }
    }
    return { added, skipped };
  }
  throw Error(`Unexpected action ${action}`);
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
async function context({ role = 'owner', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  const mock = `export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'fixture-owner'}}}}),onAuthStateChange:()=>{}};
    export async function api(){return ${JSON.stringify({ ...bootstrap, role })}}
    export async function galleryApi(action,payload){const r=await fetch('/test-gallery',{method:'POST',body:JSON.stringify({action,payload})});return r.json()}
    export async function upload(file){const bytes=[...new Uint8Array(await file.arrayBuffer())];await fetch('/test-upload',{method:'POST',body:JSON.stringify({type:file.type,name:file.name,size:file.size,header:bytes.slice(0,12)})});return {url:'${origin}/photos/uploaded.webp'}}
    export async function websiteVisitorStats(){return {}}
    ${helpers}`;
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/rest/v1/rpc/gallery_api') {
      const { p_action, p_payload } = route.request().postDataJSON();
      if (failMore && p_payload.offset) { failMore = false; return route.fulfill({ status: 503, body: 'Retry' }); }
      const body = JSON.stringify(response(p_action, p_payload));
      if (delayQuery && p_payload.query === 'Pikachu') await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ contentType: 'application/json', body });
    }
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/assets/ordering/client.js') return route.fulfill({ contentType: 'text/javascript', body: mock });
    if (/\/assets\/ordering\/(traffic|newsletter)\.js/.test(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (url.pathname === '/test-gallery') { const { action, payload } = route.request().postDataJSON(); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response(action, payload)) }); }
    if (url.pathname === '/test-upload') { uploadInfo = route.request().postDataJSON(); return route.fulfill({ body: '{}' }); }
    if (url.pathname.startsWith('/photos/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#e8d8b9"/><ellipse cx="200" cy="280" rx="130" ry="36" fill="#ab879e"/><rect x="70" y="150" width="260" height="130" rx="15" fill="#b79bc7"/><ellipse cx="200" cy="150" rx="130" ry="32" fill="#dbc5e7"/><circle cx="200" cy="105" r="35" fill="#f4db6d"/></svg>' });
    try { return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' }[extname(url.pathname)] || 'application/octet-stream', body: await readFile(join(root, url.pathname)) }); }
    catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  });
  ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return ctx;
}
try {
  const ctx = await context(), page = await ctx.newPage();
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${origin}/manage.html`);
  await page.locator('[data-view="galleries"]').click();
  await page.locator('[data-gallery-count]').filter({ hasText: '24 of 63' }).waitFor();
  await page.screenshot({ path: join(output, 'dashboard.png') });
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 2400;
    const c = canvas.getContext('2d');
    for (let y = 0; y < 2400; y += 20) for (let x = 0; x < 3200; x += 20) { c.fillStyle = `rgb(${x % 255},${y % 255},${(x + y) % 255})`; c.fillRect(x, y, 20, 20); }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const file = { name: 'phone-photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  await page.locator('[data-gallery-upload]').setInputFiles([file, file]);
  await page.locator('[data-gallery-editor-message]').filter({ hasText: 'WebP ready' }).waitFor();
  assert.match(await page.locator('[data-gallery-file-info]').textContent(), /1600 × 1200/);
  await page.locator('[data-gallery-editor] [name="category"]').fill('Characters');
  await page.locator('[data-gallery-editor] [name="keywords"]').fill('Pikachu\nPokémon');
  await page.screenshot({ path: join(output, 'upload-editor.png') });
  await page.locator('[data-gallery-editor] [type="submit"]').click();
  await page.locator('[data-gallery-editor-message]').filter({ hasText: 'WebP ready' }).waitFor();
  assert.equal(uploadInfo.type, 'image/webp'); assert.equal(String.fromCharCode(...uploadInfo.header.slice(8)), 'WEBP');
  assert.equal(photos.at(-1).title, ''); assert.equal(photos.at(-1).description, '');
  assert.deepEqual(photos.at(-1).keywords, ['Pikachu', 'Pokémon']);
  await page.locator('[data-gallery-close]').first().click();
  await page.locator('[data-gallery-edit]').first().click();
  await page.locator('[data-gallery-editor] [name="published"]').uncheck();
  await page.locator('[data-gallery-editor] [type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('.gallery-editor').open);
  assert.equal(photos[0].published, false);
  const exported = JSON.stringify([{ spec_id: 'categories', categories: ['Wedding'] }, { _id: { $oid: 'atlas-one' }, type: 'item', category: 'Wedding', picture: `${origin}/photos/old.webp`, keywords: ['white flowers'] }]);
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-gallery-import]').setInputFiles({ name: 'custom-orders.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await page.locator('[data-gallery-confirm-import]').click();
    await page.locator('[data-gallery-message]').filter({ hasText: i ? '0 photos added, 1 already imported' : '1 photos added' }).waitFor();
  }
  await page.locator('[data-gallery="pastries"]').click();
  await page.locator('[data-gallery-count]').filter({ hasText: '0 of 0' }).waitFor();
  const staff = await context({ role: 'staff' }), staffPage = await staff.newPage();
  await staffPage.goto(`${origin}/manage.html`); await staffPage.locator('[data-view="galleries"]').click();
  assert.equal(await staffPage.locator('[data-gallery-upload]').count(), 0);
  const publicPage = await ctx.newPage(); await publicPage.goto(`${origin}/customorders.html`);
  await publicPage.locator('.portfolio-count').filter({ hasText: '24 of 64' }).waitFor();
  assert.equal(await publicPage.locator('.search-customorders').isVisible(), false);
  const size = await publicPage.locator('.portfolio-card img').first().boundingBox();
  assert(Math.abs(size.width - size.height) < 1);
  await publicPage.locator('.portfolio-controls input').fill('Pokemon');
  await publicPage.locator('.portfolio-controls button').click();
  await publicPage.locator('.portfolio-count').filter({ hasText: '24 of 63' }).waitFor();
  failMore = true; await publicPage.locator('.portfolio-more').click();
  await publicPage.locator('.portfolio-more').filter({ hasText: 'Try again' }).waitFor();
  assert.equal(await publicPage.locator('.portfolio-card').count(), 24);
  await publicPage.locator('.portfolio-more').click();
  await publicPage.locator('.portfolio-count').filter({ hasText: '48 of 63' }).waitFor();
  await publicPage.locator('.portfolio-more').click();
  await publicPage.locator('.portfolio-count').filter({ hasText: '63 of 63' }).waitFor();
  assert.equal(await publicPage.locator('.portfolio-more').isVisible(), false);
  assert.equal(await publicPage.locator('.portfolio-card').count(), 63);
  assert.equal(await publicPage.locator('.portfolio-grid').getByText('Pokémon', { exact: true }).count(), 0);
  await publicPage.locator('[data-photo="0"]').click(); await publicPage.locator('.portfolio-lightbox').waitFor({ state: 'visible' });
  await publicPage.keyboard.press('Escape');
  delayQuery = true;
  await publicPage.locator('.portfolio-controls input').fill('Pikachu'); await publicPage.locator('.portfolio-controls button').click();
  await publicPage.locator('.portfolio-controls input').fill('no matches'); await publicPage.locator('.portfolio-controls button').click();
  await publicPage.locator('.portfolio-count').filter({ hasText: 'No matching' }).waitFor();
  assert.equal(await publicPage.locator('.portfolio-card').count(), 0);
  const mobile = await context({ mobile: true }), phone = await mobile.newPage();
  await phone.goto(`${origin}/customorders.html?q=Pokemon`);
  await phone.locator('.portfolio-count').filter({ hasText: '24 of 63' }).waitFor();
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await phone.screenshot({ path: join(output, 'mobile-gallery.png') });
  await phone.goto(`${origin}/manage.html`); await phone.locator('[data-view="galleries"]').click();
  await phone.locator('[data-gallery-count]').filter({ hasText: '24 of 65' }).waitFor();
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // Pastries has category sections with all metadata pages loaded automatically.
  // Interleave records so section order and lightbox indexing must survive grouping.
  const pastryPhotos = Array.from({ length: 51 }, (_, index) => ({ id: `pastry-${index}`, gallery: 'pastries', title: `Pastry ${index}`, description: '', category: index % 15 === 0 ? 'Nori Chips' : index % 17 === 0 ? 'Tiramisu' : 'Cookies', keywords: [], photo_url: `${origin}/photos/pastry-${index}.webp`, revision: 1, published: true }));
  photos.push(...pastryPhotos);
  const pastryPage = await ctx.newPage();
  failMore = true;
  await pastryPage.goto(`${origin}/pastries.html?q=no-matches`);
  await pastryPage.locator('.portfolio-more').filter({ hasText: 'Try again' }).waitFor();
  assert.equal(await pastryPage.locator('.portfolio-card').count(), 0);
  await pastryPage.locator('.portfolio-more').click();
  await pastryPage.locator('.portfolio-count').filter({ hasText: '51 photos' }).waitFor();
  assert.equal(await pastryPage.locator('input[type="search"]').count(), 0);
  assert.equal(await pastryPage.getByRole('button', { name: 'Search', exact: true }).count(), 0);
  assert.equal(await pastryPage.locator('.portfolio-more').isVisible(), false);
  assert.equal(await pastryPage.locator('.portfolio-card').count(), 51);
  assert.deepEqual(await pastryPage.locator('.portfolio-category h2').allTextContents(), ['Tiramisu', 'Nori Chips', 'Cookies']);
  assert.deepEqual(await pastryPage.locator('.portfolio-category').evaluateAll(sections => sections.map(section => section.querySelectorAll('.portfolio-card').length)), [2, 4, 45]);
  assert(calls.filter(c => c.payload.gallery === 'pastries' && c.action === 'browse').every(c => !c.payload.query));
  await pastryPage.locator('.portfolio-category').first().locator('[data-photo]').first().click();
  assert.equal(await pastryPage.locator('.portfolio-lightbox img').getAttribute('src'), `${origin}/photos/pastry-17.webp`);
  await pastryPage.keyboard.press('Escape');
  await pastryPage.screenshot({ path: join(output, 'pastries-desktop.png') });
  await pastryPage.locator('.portfolio-controls select').selectOption('Nori Chips');
  await pastryPage.locator('.portfolio-count').filter({ hasText: '4 photos' }).waitFor();
  assert.deepEqual(await pastryPage.locator('.portfolio-category h2').allTextContents(), ['Nori Chips']);
  await pastryPage.locator('.portfolio-controls select').selectOption('');
  await pastryPage.locator('.portfolio-count').filter({ hasText: '51 photos' }).waitFor();
  await phone.goto(`${origin}/pastries.html`);
  await phone.locator('.portfolio-count').filter({ hasText: '51 photos' }).waitFor();
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await phone.screenshot({ path: join(output, 'pastries-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('PASS gallery uploads, WebP dimensions/bytes, optional fields, upload queue, edit visibility, idempotent imports, role UI, all search results, retry, stale requests, lightbox, grouped pastries without search, all pastry pages, category filtering and mobile layouts');
} finally { await browser.close(); }
