// Real HEIC decoding; only the pinned decoder CDN may make external requests.
// Catalog, authentication and uploaded files remain local fixtures.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
assert(process.env.HEIC_TEST_FILE, 'Set HEIC_TEST_FILE to a real HEIC fixture.');
const heic = await readFile(process.env.HEIC_TEST_FILE);
const origin = 'https://product-heic.test';
const catalog = { role: 'owner', categories: [], orders: [], inventory: [], promos: [], zones: [], staff: [], email_status: [],
  settings: { paused: false, production_weekdays: [0,1,2,3,4,5,6], fulfillment_weekdays: [0,1,2,3,4,5,6] },
  products: [{ id: 'cake', name: 'Cake', description: '', price_cents: 13000, min_quantity: 1, lead_days: 1, active: true, photos: [], option_groups: [] }] };
const client = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const mock = `export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'local-owner'}}}}),onAuthStateChange:()=>{}};
const data=${JSON.stringify(catalog)};
export async function api(action,payload={}){if(action==='admin_bootstrap')return data;if(action==='save_product'){data.products[0]=structuredClone(payload.product);return data.products[0]}throw Error(action)}
export async function upload(file,options){
 if(window.holdUpload)await new Promise(resolve=>window.finishUpload=resolve);
 const bytes=new Uint8Array(await file.arrayBuffer()),image=await createImageBitmap(file);
 (window.uploaded||=[]).push({name:file.name,type:file.type,size:file.size,kind:options.kind,width:image.width,height:image.height,header:Array.from(bytes.slice(0,12))});image.close();
 return {url:'https://product-heic.test/photo.svg'}
}
export async function websiteVisitorStats(){return {}}
${client.slice(client.indexOf('export function money('))}`;
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined});
const errors = [], checks = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({viewport: {width: mobile ? 390 : 1280, height: 900}, isMobile: mobile, hasTouch: mobile});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'esm.sh') return route.continue();
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/photo.svg') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="purple"/></svg>'});
      if (url.pathname === '/assets/ordering/client.js') return route.fulfill({contentType: 'text/javascript', body: mock});
      if (['/assets/ordering/traffic.js','/assets/ordering/newsletter.js'].includes(url.pathname)) return route.fulfill({contentType: 'text/javascript', body: ''});
      try { return await route.fulfill({contentType: ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(url.pathname)] || 'application/octet-stream', body: await readFile(join(root, url.pathname))}); }
      catch { return route.fulfill({status: 404, body: ''}); }
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/manage.html`, {waitUntil: 'networkidle'});
    await page.locator('[data-view="products"]').first().click();
    await page.locator('[data-action="edit-product"]').first().click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator('[name="description"]').fill('Preserve this draft');
    assert.equal(await page.locator('[name="description"]').inputValue(), 'Preserve this draft');
    const input = page.locator('#product-photos');
    assert.match(await input.getAttribute('accept'), /image\/heic/);
    assert.match(await input.getAttribute('accept'), /\.heif/);
    await page.evaluate(() => { window.holdUpload = true; });
    await input.setInputFiles({name: mobile ? 'iPhone.HEIF' : 'iPhone.HEIC', mimeType: mobile ? '' : 'image/heic', buffer: heic});
    await page.waitForFunction(() => typeof window.finishUpload === 'function', null, {timeout: 60000});
    assert(await page.locator('[data-form="product"] button[type="submit"]').isDisabled());
    await page.evaluate(() => { window.holdUpload = false; window.finishUpload(); });
    await page.waitForFunction(() => document.querySelectorAll('.photo-tile').length === 1);
    const uploaded = await page.evaluate(() => window.uploaded[0]);
    assert.equal(uploaded.type, 'image/webp');
    assert.equal(uploaded.name, 'iPhone.webp');
    assert.equal(uploaded.kind, 'product');
    assert(uploaded.size > 0 && uploaded.size <= 5 * 1024 * 1024);
    assert(uploaded.width > 0 && uploaded.height > 0 && Math.max(uploaded.width, uploaded.height) <= 1600);
    assert.equal(Buffer.from(uploaded.header).toString('ascii', 0, 4), 'RIFF');
    assert.equal(Buffer.from(uploaded.header).toString('ascii', 8, 12), 'WEBP');
    assert.equal(await page.locator('[name="description"]').inputValue(), 'Preserve this draft');
    await input.setInputFiles({name:'broken.heic',mimeType:'image/heic',buffer:Buffer.from('Not an image')});
    await page.waitForFunction(() => document.querySelector('[data-form="product"] .form-error').textContent.includes('could not be converted'));
    assert.equal(await page.locator('.photo-tile').count(), 1);
    assert(!(await page.locator('[data-form="product"] button[type="submit"]').isDisabled()));
    const jpeg = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10;
      canvas.getContext('2d').fillRect(0, 0, 10, 10);
      return canvas.toDataURL('image/jpeg').split(',')[1];
    });
    await input.setInputFiles([{name:'regular.jpg',mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')},{name:'another.heic',mimeType:'application/octet-stream',buffer:heic}]);
    await page.waitForFunction(() => document.querySelectorAll('.photo-tile').length === 3);
    assert.deepEqual(await page.evaluate(() => window.uploaded.map(file => file.type)), ['image/webp','image/jpeg','image/webp']);
    await page.locator('[data-form="product"] button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('#admin-dialog').open);
    await page.locator('[data-action="edit-product"]').first().click();
    assert.equal(await page.locator('.photo-tile').count(), 3);
    assert.equal(await page.locator('[name="description"]').inputValue(), 'Preserve this draft');
    const validation = await page.evaluate(async () => {
      const {prepareProductImage} = await import('/assets/ordering/product-image.js');
      const results = [];
      for (const file of [new File([], 'empty.heic', {type:'image/heic'}), new File([new Uint8Array(25*1024*1024+1)], 'large.heic', {type:'image/heic'}), new File([new Uint8Array(5*1024*1024+1)], 'large.png', {type:'image/png'}),new File(['x'], 'image.svg', {type:'image/svg+xml'})]) {
        try { await prepareProductImage(file); results.push('accepted'); } catch (error) { results.push(error.message); }
      }
      for (const type of ['image/jpeg','image/png','image/webp']) {
        const file = new File(['fixture'], 'regular', {type}); results.push(await prepareProductImage(file) === file);
      }
      return results;
    });
    assert.match(validation[0], /Choose a photo/);
    assert.match(validation[1], /25 MB/);
    assert.match(validation[2], /5 MB/);
    assert.match(validation[3], /Use a JPEG/);
    assert.deepEqual(validation.slice(4), [true,true,true]);
    checks.push(`${mobile ? 'Mobile' : 'Desktop'}: real HEIC/HEIF conversion, output signature/dimensions/size, upload lock, failed conversion recovery, mixed uploads, save/reopen, draft preservation, empty/oversized/unsupported input`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({checks, errors}));
} finally { await browser.close(); }
