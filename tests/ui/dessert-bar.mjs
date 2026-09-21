// Browser fixtures only. No production sign-in, uploads or content writes.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://dessert.test',output=join(root,'test-results/dessert-bar');
await mkdir(output,{recursive:true});
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZfoAAAAASUVORK5CYII=','base64');
const party={items:[{id:'party-only',name:'Party-only package',subtitle:'',price_cents:900000,badge:'',features:[{label:'Party cart serving',detail:'Party-only detail'}],published:true,sort_order:1,revision:1,created_at:'2026-09-21'}],settings:{inclusions:[{label:'Party setup',detail:''}],revision:1}};
const originalParty=JSON.stringify(party),calls=[],errors=[],uploads=[];
let packages=[],settings={inclusions:[],revision:1},custom={items:[],revision:1},photos={items:[],revision:1},failSave=false;
function rpc(kind,action,payload={}) {
  calls.push({kind,action});
  if(kind==='packages'){
    if(action==='admin_list'||action==='browse')return {items:packages.filter(p=>action==='admin_list'||p.published),settings};
    if(action==='save_settings'){settings={inclusions:payload.inclusions,revision:settings.revision+1};return settings;}
    if(action==='delete'){packages=packages.filter(p=>p.id!==payload.id);return {deleted:true};}
    if(action==='save'){
      if(failSave){failSave=false;throw Error('Please retry. Your draft is retained.');}
      const next={...payload.package,revision:payload.package.revision+1,created_at:'2026-09-21'};
      const index=packages.findIndex(p=>p.id===next.id);if(index<0)packages.push(next);else packages[index]=next;return next;
    }
  }
  if(kind==='items'){
    if(action==='save')custom={items:payload.items,revision:custom.revision+1};
    return custom;
  }
  if(kind==='photos'){
    if(action==='save')photos={items:payload.items,revision:photos.revision+1};
    return action==='browse'?{items:photos.items.filter(p=>p.published)}:photos;
  }
  throw Error('Unexpected fixture action');
}
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH});
async function context(role='owner',mobile=false){
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
  const bootstrap=JSON.stringify({role,products:[],orders:[],categories:[],inventory:[],promos:[],zones:[],staff:[],settings:{paused:false}});
  let mock="export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange:()=>{}};export async function api(){return "+bootstrap+"};export async function websiteVisitorStats(){return {}};";
  mock+="async function rpc(kind,action,payload={}){const r=await fetch('/fixture/'+kind,{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.message);return d;}";
  for(const [name,kind] of [['dessertBarPackagesApi','packages'],['dessertBarItemsApi','items'],['dessertBarPhotosApi','photos']])mock+="export async function "+name+"(a,p){return rpc('"+kind+"',a,p)};";
  mock+="export async function partyPackagesApi(){return "+JSON.stringify(party)+"};export async function partyCartItemsApi(){return {items:['Party-only treat'],revision:1}};export async function partyCartPhotosApi(){return {items:[],revision:1}};";
  mock+="export async function upload(file){return (await fetch('/upload',{method:'POST',body:JSON.stringify({type:file.type,name:file.name,size:file.size})})).json()};"+helpers;
  await ctx.route('**/*',async route=>{
    const u=new URL(route.request().url()),path=u.pathname;
    const endpoint=path.match(/^\/rest\/v1\/rpc\/dessert_bar_(packages|items|photos)_api$/),fixture=path.match(/^\/fixture\/(packages|items|photos)$/);
    if(endpoint||fixture){
      const b=route.request().postDataJSON();
      try{return route.fulfill({contentType:'application/json',body:JSON.stringify(rpc((endpoint||fixture)[1],b.p_action||b.action,b.p_payload||b.payload))});}
      catch(e){return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:e.message})});}
    }
    if(path==='/rest/v1/rpc/party_packages_api')return route.fulfill({contentType:'application/json',body:JSON.stringify(party)});
    if(path==='/rest/v1/rpc/party_cart_items_api')return route.fulfill({contentType:'application/json',body:'{"items":["Party-only treat"]}'});
    if(path==='/rest/v1/rpc/party_cart_photos_api')return route.fulfill({contentType:'application/json',body:'{"items":[]}'});
    if(path==='/upload'){
      uploads.push(route.request().postDataJSON());
      return route.fulfill({contentType:'application/json',body:JSON.stringify({url:'https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/11111111-1111-4111-8111-111111111111/0000000'+uploads.length+'-1111-4111-8111-111111111111.webp'})});
    }
    if(path.startsWith('/storage/v1/object/public/product-images/'))return route.fulfill({contentType:'image/png',body:png});
    if(u.origin!==origin)return route.abort();
    if(path==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
    if(/\/assets\/ordering\/(traffic|newsletter)\.js/.test(path))return route.fulfill({contentType:'text/javascript',body:''});
    try{return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'}[extname(path)]||'application/octet-stream',body:await readFile(join(root,decodeURIComponent(path)))});}
    catch{
      if(process.env.PARTY_PHOTO_ASSETS_ROOT){try{return route.fulfill({contentType:{'.css':'text/css','.js':'text/javascript','.png':'image/png','.woff2':'font/woff2'}[extname(path)]||'application/octet-stream',body:await readFile(join(process.env.PARTY_PHOTO_ASSETS_ROOT,decodeURIComponent(path)))});}catch{}}
      return route.fulfill({status:404,body:'Missing fixture asset'});
    }
  });
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));return ctx;
}
try {
  const ctx=await context(),publicPage=await ctx.newPage();
  await publicPage.goto(origin+'/dessertbar.html');await publicPage.locator('[data-cart-gallery-status]').filter({hasText:'coming soon'}).waitFor();
  assert.equal(await publicPage.locator('.party-card,[data-cart-thumb]').count(),0);
  assert(!(await publicPage.locator('main').innerText()).includes('Party-only'));
  await publicPage.screenshot({path:join(output,'empty-desktop.png'),fullPage:true});
  const admin=await ctx.newPage();let accept=true;admin.on('dialog',d=>accept?d.accept():d.dismiss());
  await admin.goto(origin+'/manage.html#dessert');await admin.getByText('No packages yet. Add your first package.').waitFor();
  assert.equal(await admin.locator('#party-package-manager h1').innerText(),'Dessert bar');
  await admin.locator('[data-party-settings]').click();assert.equal(await admin.locator('[data-feature-label]').count(),0);
  await admin.locator('[data-feature-add]').click();await admin.locator('[data-feature-label]').fill('Dessert display setup');
  await admin.locator('[data-party-form] button[type="submit"]').click();await admin.locator('.party-editor').waitFor({state:'hidden'});
  await admin.locator('[data-party-new]').click();await admin.locator('[name="name"]').fill('Dessert tasting');
  await admin.locator('[name="price"]').fill('9500');await admin.locator('[data-feature-label]').fill('60 dessert cups');await admin.locator('[data-feature-detail]').fill('Choose your favorite flavors');
  assert(await admin.locator('.party-feature-detail').isVisible());
  failSave=true;await admin.locator('[data-party-form] button[type="submit"]').click();await admin.locator('[data-party-error]').filter({hasText:'retry'}).waitFor();assert.equal(await admin.locator('[name="name"]').inputValue(),'Dessert tasting');
  await admin.locator('[data-party-form] button[type="submit"]').click();await admin.locator('.party-editor').waitFor({state:'hidden'});
  await admin.locator('[data-party-cart]').click();await admin.locator('[data-feature-add]').click();await admin.locator('[data-feature-label]').fill('Brownie bites');
  await admin.locator('[data-feature-add]').click();await admin.locator('[data-feature-label]').last().fill('Tiramisu cups');await admin.locator('[data-feature-up]').last().click();
  await admin.locator('[data-party-form] button[type="submit"]').click();await admin.locator('.party-editor').waitFor({state:'hidden'});
  await admin.locator('[data-cart-photo-upload]').setInputFiles([{name:'dessert-one.png',mimeType:'image/png',buffer:png},{name:'dessert-two.png',mimeType:'image/png',buffer:png}]);
  await admin.locator('[data-cart-photo-message]').filter({hasText:'2 photos ready'}).waitFor();assert(uploads.every(f=>f.type==='image/webp'&&f.name.endsWith('.webp')));
  await admin.locator('[data-cart-photo-caption="0"]').fill('Dessert table');await admin.locator('[data-photo-move="0"]').press('ArrowRight');
  accept=false;await admin.locator('[data-view="packages"]').click();assert.equal(await admin.locator('#party-package-manager h1').innerText(),'Dessert bar');accept=true;
  await admin.locator('[data-cart-photo-save]').click();await admin.locator('[data-cart-photo-message]').filter({hasText:'Saved.'}).waitFor();
  await publicPage.reload();await publicPage.locator('.party-card').waitFor();await publicPage.locator('[data-cart-thumb]').first().waitFor();
  assert.equal(await publicPage.locator('.party-card h3').innerText(),'Dessert tasting');assert(await publicPage.locator('.party-feature-detail').isVisible());
  assert.equal(await publicPage.locator('summary,[data-slideshow-toggle]').count(),0);
  assert.deepEqual(await publicPage.locator('[data-party-cart-item]').allTextContents(),['Tiramisu cups','Brownie bites']);
  assert.deepEqual(await publicPage.locator('[data-cart-thumb] img').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('src'))),photos.items.map(p=>p.photo_url));
  await admin.locator('[data-view="packages"]').click();await admin.locator('.party-admin-item h2').filter({hasText:'Party-only package'}).waitFor();
  await admin.locator('[data-view="dessert"]').click();await admin.locator('.party-admin-item h2').filter({hasText:'Dessert tasting'}).waitFor();
  await admin.reload();await admin.locator('.party-admin-item h2').filter({hasText:'Dessert tasting'}).waitFor();
  const phoneCtx=await context('owner',true),phone=await phoneCtx.newPage();await phone.goto(origin+'/dessertbar.html');await phone.locator('[data-cart-thumb]').first().waitFor();
  assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal((await phone.locator('.cart-showcase-copy h1').innerText()).replace(/\s+/g,' '),'A dessert bar full of happy moments.');
  await phone.screenshot({path:join(output,'mobile.png'),fullPage:true});
  await phone.locator('.cart-viewer-image').scrollIntoViewIfNeeded();const box=await phone.locator('.cart-viewer-image').boundingBox();
  const cdp=await phoneCtx.newCDPSession(phone);await cdp.send('Input.synthesizeScrollGesture',{x:box.x+box.width/2,y:box.y+box.height/2,xDistance:-120,gestureSourceType:'touch',preventFling:true,speed:800});
  assert.equal(await phone.locator('[data-cart-count]').innerText(),'2 / 2');assert(!(await phone.locator('[data-cart-lightbox]').isVisible()));
  await phone.locator('[data-cart-count]').filter({hasText:'1 / 2'}).waitFor({timeout:5000});
  await admin.locator('[data-party-edit]').click();await admin.locator('[name="name"]').fill('Edited dessert package');await admin.locator('[data-party-form] button[type="submit"]').click();await admin.locator('.party-editor').waitFor({state:'hidden'});
  await admin.locator('[data-party-delete]').click();await admin.getByText('No packages yet. Add your first package.').waitFor();
  await admin.locator('[data-party-settings]').click();await admin.locator('[data-feature-remove]').click();await admin.locator('[data-party-form] button[type="submit"]').click();await admin.locator('.party-editor').waitFor({state:'hidden'});assert.deepEqual(settings.inclusions,[]);
  const staff=await context('staff'),staffPage=await staff.newPage(),before=calls.length;
  await staffPage.goto(origin+'/manage.html#dessert');await staffPage.getByText('Sign in with the owner account to add or edit dessert bar packages.').waitFor();assert.equal(calls.length,before);
  assert.equal(await staffPage.locator('[data-party-new],[data-cart-photo-upload]').count(),0);
  assert.equal(JSON.stringify(party),originalParty);assert.deepEqual(errors,[]);
  console.log('PASS empty dessert page, owner package CRUD/retry, optional inclusions, custom items, WebP upload/reorder/persistence, dirty guards, separate party content, mobile swipe/autoplay and staff denial.');
} finally { await browser.close(); }
