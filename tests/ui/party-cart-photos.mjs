// Browser fixtures only: no real sign-in, uploads, or production mutations.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..'), origin = 'https://cart.test';
const output = join(root, 'test-results/party-cart-photos'); await mkdir(output, { recursive: true });
const seed = JSON.parse(await readFile(join(root, 'tests/party-cart-photos-seed.json'), 'utf8'));
const client = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = client.slice(client.indexOf('export function money('));
const photoPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZfoAAAAASUVORK5CYII=', 'base64');
let data = { items: structuredClone(seed), revision: 1 }, failSave = false, failBrowse = false, holdUpload;
const calls = [], uploads = [], errors = [];
const packageData = { items: [{ id: 'package-1', name: 'Package 1', subtitle: 'Cookie A La Mode', price_cents: 900000, badge: '', features: [{label:'50 Cookie A La Mode',detail:'Classic Choco Chip Cookie topped w/ Ice Cream'}], published: true, sort_order: 1, revision: 1, created_at:'2026-09-20' }], settings: { inclusions: [{label:'4 Hours Duration',detail:''}], revision:1 } };
function response(action, payload={}) {
  calls.push({ action, payload: structuredClone(payload) });
  if (action === 'browse') return { items: data.items.filter(p=>p.published).map(({published,...p})=>p) };
  if (action === 'admin_get') return data;
  if (action === 'save') {
    if (failSave) { failSave=false; throw Error('Connection lost. Try again.'); }
    assert.equal(payload.revision, data.revision); data = {items:payload.items,revision:data.revision+1}; return data;
  }
  throw Error('Unexpected photo action');
}
const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
async function context({role='owner',mobile=false,reducedMotion='no-preference'}={}) {
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1050},hasTouch:mobile,reducedMotion});
  const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange:()=>{}};
    export async function api(){return ${JSON.stringify({role,products:[],orders:[],categories:[],inventory:[],promos:[],zones:[],staff:[],settings:{paused:false}})}};
    export async function partyPackagesApi(){return ${JSON.stringify(packageData)}};
    export async function partyCartItemsApi(){return {items:['Cookie A La Mode','Nori Chips Cups'],revision:1}};
    export async function partyCartPhotosApi(action,payload){const r=await fetch('/test-photos',{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.message);return d};
    export async function upload(file){const image=await createImageBitmap(file),header=[...new Uint8Array(await file.arrayBuffer())].slice(0,12);const r=await fetch('/test-upload',{method:'POST',body:JSON.stringify({name:file.name,type:file.type,size:file.size,header,width:image.width,height:image.height})});image.close();return r.json()};
    export async function websiteVisitorStats(){return {}};${helpers}`;
  await ctx.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/test-upload'){
      uploads.push(route.request().postDataJSON());if(holdUpload)await holdUpload;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({url:`https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/11111111-1111-4111-8111-111111111111/${String(uploads.length).padStart(8,'0')}-1111-4111-8111-111111111111.webp`})});
    }
    if(u.pathname==='/test-photos'||u.pathname==='/rest/v1/rpc/party_cart_photos_api'){
      if(failBrowse&&u.pathname.startsWith('/rest/')){failBrowse=false;return route.fulfill({status:503,body:'Unavailable'});}
      try{const body=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(response(body.action||body.p_action,body.payload||body.p_payload))});}
      catch(error){return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:error.message})});}
    }
    if(u.pathname==='/rest/v1/rpc/party_packages_api')return route.fulfill({contentType:'application/json',body:JSON.stringify(packageData)});
    if(u.pathname==='/rest/v1/rpc/party_cart_items_api')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:['Cookie A La Mode','Nori Chips Cups']})});
    if(u.pathname.startsWith('/storage/v1/object/public/product-images/'))return route.fulfill({contentType:'image/png',body:photoPng});
    if(u.origin!==origin)return route.abort();
    if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
    if(/\/assets\/ordering\/(traffic|newsletter)\.js/.test(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
    try{return route.fulfill({contentType:mime[extname(u.pathname)]||'application/octet-stream',body:await readFile(join(root,decodeURIComponent(u.pathname)))});}
    catch{
      if(process.env.PARTY_PHOTO_ASSETS_ROOT){try{return route.fulfill({contentType:mime[extname(u.pathname)]||'application/octet-stream',body:await readFile(join(process.env.PARTY_PHOTO_ASSETS_ROOT,decodeURIComponent(u.pathname)))});}catch{}}
      if(/\.(jpg|webp)$/.test(u.pathname))return route.fulfill({contentType:'image/png',body:photoPng});return route.fulfill({status:404,body:'Not found'});
    }
  });
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));return ctx;
}
async function frozenPage(ctx){const p=await ctx.newPage();await p.clock.install({time:new Date('2026-09-21T00:00:00Z')});await p.clock.pauseAt(new Date('2026-09-21T00:00:01Z'));return p;}
const count=p=>p.locator('[data-cart-count]').innerText();
async function drag(page,from,to,touch=false){
  await page.locator(`[data-photo-move="${from}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-photo-move="${to}"]`).scrollIntoViewIfNeeded();
  const a=await page.locator(`[data-photo-move="${from}"]`).boundingBox(),b=await page.locator(`[data-photo-move="${to}"]`).boundingBox();
  const start={x:a.x+a.width/2,y:a.y+a.height/2},end={x:b.x+b.width/2,y:b.y+b.height/2};
  if(touch){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();}
}
try{
  const ctx=await context(),page=await frozenPage(ctx);await page.goto(origin+'/partycarts.html');await page.locator('[data-cart-thumb]').first().waitFor();
  assert.equal(await page.locator('[data-cart-thumb]').count(),17);assert.equal(await count(page),'1 / 17');
  await page.evaluate(()=>document.fonts.ready);await page.locator('[data-cart-featured]').evaluate(img=>img.decode());await page.screenshot({path:join(output,'public-desktop.png')});
  await page.clock.runFor(3999);assert.equal(await count(page),'1 / 17');await page.clock.runFor(1);assert.equal(await count(page),'2 / 17');
  for(let i=0;i<16;i++)await page.clock.runFor(4000);assert.equal(await count(page),'1 / 17');
  await page.locator('[data-cart-gallery]').dispatchEvent('pointerenter',{pointerType:'mouse'});await page.clock.runFor(8000);assert.equal(await count(page),'1 / 17');
  await page.locator('[data-cart-gallery]').dispatchEvent('pointerleave');await page.clock.runFor(3000);await page.locator('body').dispatchEvent('pointermove');await page.clock.runFor(3999);assert.equal(await count(page),'1 / 17');await page.clock.runFor(1);assert.equal(await count(page),'2 / 17');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(12000);assert.equal(await count(page),'2 / 17');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(4000);assert.equal(await count(page),'3 / 17');
  await page.locator('[data-slideshow-toggle]').click();await page.clock.runFor(8000);assert.equal(await count(page),'3 / 17');
  await page.locator('[data-slideshow-toggle]').click();await page.clock.runFor(4000);assert.equal(await count(page),'4 / 17');
  await page.locator('[data-cart-thumb="16"]').click();await page.locator('[data-cart-step="1"]').click();assert.equal(await count(page),'1 / 17');
  await page.locator('[data-cart-open-all]').click();await page.clock.runFor(8000);assert.equal(await count(page),'1 / 17');
  await page.locator('[data-cart-light-step="-1"]').click();assert.match(await page.locator('[data-cart-light-caption]').innerText(),/17 \/ 17/);await page.keyboard.press('Escape');
  assert(!(await page.locator('[data-cart-lightbox]').isVisible()));
  const reduced=await context({reducedMotion:'reduce'}),reducedPage=await frozenPage(reduced);await reducedPage.goto(origin+'/partycarts.html');await reducedPage.locator('[data-cart-thumb]').first().waitFor();await reducedPage.clock.runFor(12000);assert.equal(await count(reducedPage),'1 / 17');assert.equal(await reducedPage.locator('[data-slideshow-toggle]').innerText(),'Play slideshow');
  console.log('PASS 4-second idle advance, automatic/manual wrap, user activity, hover, hidden tab, pause/play, enlarged gallery, reduced motion.');
  const admin=await ctx.newPage();let accept=true;admin.on('dialog',d=>accept?d.accept():d.dismiss());await admin.goto(origin+'/manage.html#packages');await admin.locator('[data-cart-photo-caption]').first().waitFor();assert.equal(await admin.locator('.cart-photo-card').count(),17);
  await admin.locator('#party-cart-photo-manager h2').evaluate(el=>el.scrollIntoView({block:'start'}));await admin.screenshot({path:join(output,'admin-desktop.png')});
  const original=await admin.locator('[data-photo-move] img').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('src')));
  await drag(admin,1,0);assert.equal(await admin.locator('[data-photo-move="0"] img').getAttribute('src'),original[1]);
  await admin.locator('[data-photo-move="0"]').press('ArrowRight');assert.equal(await admin.locator('[data-photo-move="0"] img').getAttribute('src'),original[0]);
  await admin.locator('[data-cart-photo-caption="0"]').fill('Updated <img src=x onerror=alert(1)> caption');await admin.locator('[data-cart-photo-visible="1"]').uncheck();
  accept=false;await admin.locator('[data-cart-photo-remove="2"]').click();assert.equal(await admin.locator('.cart-photo-card').count(),17);
  await admin.locator('[data-view="overview"]').click();assert.equal(await admin.locator('.cart-photo-card').count(),17);accept=true;
  await admin.locator('[data-cart-photo-remove="2"]').click();assert.equal(await admin.locator('.cart-photo-card').count(),16);
  const png=await admin.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1200;canvas.getContext('2d').fillRect(0,0,2400,1200);return canvas.toDataURL('image/png').split(',')[1];});
  let release;holdUpload=new Promise(r=>{release=r;});await admin.locator('[data-cart-photo-upload]').setInputFiles({name:'large-party.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await admin.locator('[data-cart-photo-message]').filter({hasText:'Converting and uploading'}).waitFor();assert(await admin.locator('[data-cart-photo-save]').isDisabled());
  await admin.locator('[data-view="overview"]').click();assert.equal(await admin.locator('.cart-photo-card').count(),16);release();holdUpload=null;
  await admin.locator('[data-cart-photo-message]').filter({hasText:'1 photo ready'}).waitFor();
  assert.equal(uploads[0].type,'image/webp');assert.match(uploads[0].name,/\.webp$/);assert.equal(String.fromCharCode(...uploads[0].header.slice(8)),'WEBP');assert.equal(uploads[0].width,1600);assert.equal(uploads[0].height,800);
  assert.equal(await admin.locator('.cart-photo-card').count(),17);
  failSave=true;await admin.locator('[data-cart-photo-save]').click();await admin.locator('[data-cart-photo-message]').filter({hasText:'Connection lost'}).waitFor();assert.equal(await admin.locator('[data-cart-photo-caption="0"]').inputValue(),'Updated <img src=x onerror=alert(1)> caption');
  await admin.locator('[data-cart-photo-save]').click();await admin.locator('[data-cart-photo-message]').filter({hasText:'Saved.'}).waitFor();const saves=calls.filter(c=>c.action==='save');assert.equal(saves[0].payload.operation_id,saves[1].payload.operation_id);
  await admin.reload();await admin.locator('[data-cart-photo-caption]').first().waitFor();assert.match(await admin.locator('[data-cart-photo-caption="0"]').inputValue(),/Updated/);assert.equal(await admin.locator('[data-cart-photo-visible="1"]').isChecked(),false);
  await admin.locator('[data-cart-photo-replace="0"]').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:photoPng});await admin.locator('[data-cart-photo-message]').filter({hasText:'1 photo ready'}).waitFor();assert.equal(await admin.locator('.cart-photo-card').count(),17);
  await admin.locator('[data-cart-photo-reset]').click();assert.equal(await admin.locator('[data-photo-move="0"] img').getAttribute('src'),original[0]);
  await admin.locator('[data-cart-photo-upload]').setInputFiles({name:'bad.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not an image')});await admin.locator('[data-cart-photo-message]').filter({hasText:'could not be opened'}).waitFor();assert.equal(await admin.locator('.cart-photo-card').count(),17);
  await page.reload();await page.locator('[data-cart-thumb]').first().waitFor();assert.equal(await page.locator('[data-cart-thumb]').count(),16);assert.equal(await page.locator('[data-cart-caption] img').count(),0);assert.match(await page.locator('[data-cart-caption]').innerText(),/Updated <img/);
  const mobile=await context({mobile:true}),phone=await mobile.newPage();phone.on('dialog',d=>d.accept());await phone.goto(origin+'/manage.html#packages');await phone.locator('[data-cart-photo-caption]').first().waitFor();await drag(phone,1,0,true);assert.equal(await phone.locator('[data-photo-move="0"] img').getAttribute('src'),data.items[1].photo_url);assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await phone.locator('[data-cart-photo-caption="0"]').fill('Draft caption');await phone.screenshot({path:join(output,'admin-mobile.png')});await phone.locator('[data-cart-photo-reset]').click();
  await phone.goto(origin+'/partycarts.html');await phone.locator('[data-cart-thumb]').first().waitFor();assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:join(output,'public-mobile.png'),fullPage:true});
  const staff=await context({role:'staff'}),staffPage=await staff.newPage(),reads=calls.filter(c=>c.action==='admin_get').length;await staffPage.goto(origin+'/manage.html#packages');await staffPage.getByText('Sign in with the owner account to add or edit party packages.').waitFor();assert.equal(await staffPage.locator('[data-cart-photo-upload]').count(),0);assert.equal(calls.filter(c=>c.action==='admin_get').length,reads);
  failBrowse=true;await page.reload();await page.locator('[data-cart-gallery-retry]:not([hidden])').waitFor();await page.locator('[data-cart-gallery-retry]').click();await page.locator('[data-cart-thumb]').first().waitFor();
  data={items:[seed[0]],revision:data.revision+1};await page.reload();await page.locator('[data-cart-thumb]').first().waitFor();assert(await page.locator('[data-slideshow-toggle]').isHidden());await page.clock.runFor(12000);assert.equal(await count(page),'1 / 1');
  data={items:[],revision:data.revision+1};await page.reload();await page.locator('[data-cart-gallery-status]').filter({hasText:'More celebration photos'}).waitFor();assert(await page.locator('[data-cart-viewer]').isHidden());
  assert.deepEqual(errors,[]);console.log('PASS owner upload/WebP/resize, mouse/touch/keyboard ordering, caption/visibility/remove/replace/reset, dirty/busy guards, save retry, reload, public order, staff denial, error/empty/single states, mobile width.');
}finally{await browser.close();}
