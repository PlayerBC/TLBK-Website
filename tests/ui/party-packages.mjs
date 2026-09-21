// All writes are browser fixtures. Never signs in to or mutates production.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..'), origin = 'https://party.test';
const output = join(root,'test-results/party-packages'); await mkdir(output,{recursive:true});
const client = await readFile(join(root,'assets/ordering/client.js'),'utf8');
const helpers = client.slice(client.indexOf('export function money('));
const bootstrap = { role:'owner', products:[], categories:[], orders:[], inventory:[], promos:[], zones:[], staff:[], settings:{paused:false} };
const items = Array.from({length:4},(_,i)=>({id:`package-${i+1}`,name:`Package ${i+1}`,subtitle:'',price_cents:i===2?1050000:900000,badge:i===2?'Most Popular':i===3?'New!':'',features:[{label:i===1?'100 Cups Nori Chips':'50 Cookie A La Mode',detail:'Choose your flavors'},{label:'Choose 3 Flavors',detail:'Vanilla, Chocolate, Strawberry'}],published:true,sort_order:(i+1)*10,revision:1,created_at:'2026-09-20T00:00:00Z'}));
let settings={revision:1,inclusions:[{label:'4 Hours Duration',detail:''},{label:'Full Cart Setup',detail:''},{label:'2 Servers',detail:''},{label:'Free Delivery Within Quezon City',detail:'Excluding Novaliches & Payatas'}]},failSave=false,failBrowse=false;
const calls=[],errors=[];
let failDelete=false,deleteGate;
let cart={items:['Cookie A La Mode','Nori Chips Cups','Panna Cotta Cups'],revision:1},failCartSave=false,failCartBrowse=false;
const cartCalls=[];
function cartResponse(action,payload={}) {
  cartCalls.push({action,payload});
  if(action==='browse'||action==='admin_get')return cart;
  if(action==='save'){
    if(failCartSave){failCartSave=false;throw Error('Cart changed in another window. Your edits are still here.');}
    cart={items:payload.items,revision:cart.revision+1};return cart;
  }
  throw Error('Unexpected cart action');
}
function response(action,payload={}) {
  calls.push({action,payload});
  if(action==='admin_list'||action==='browse')return {items:items.filter(p=>action==='admin_list'||p.published).sort((a,b)=>a.sort_order-b.sort_order),settings};
  if(action==='save'){
    if(failSave){failSave=false;throw Error('Connection lost. Your edits are still here.');}
    const p={...payload.package,revision:payload.package.revision+1,created_at:'2026-09-20T00:00:00Z'};
    const index=items.findIndex(i=>i.id===p.id);if(index<0)items.push(p);else items[index]=p;return p;
  }
  if(action==='save_settings'){settings={inclusions:payload.inclusions,revision:settings.revision+1};return settings;}
  if(action==='delete'){
    if(failDelete){failDelete=false;throw Error('Could not delete the package. Try again.');}
    const index=items.findIndex(p=>p.id===payload.id);
    if(index>=0){assert.equal(payload.revision,items[index].revision);items.splice(index,1);}
    return {id:payload.id,deleted:true};
  }
  throw Error(`Unexpected action ${action}`);
}
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
async function context({role='owner',mobile=false}={}){
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});
  const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange:()=>{}};export async function api(){return ${JSON.stringify({...bootstrap,role})}};export async function upload(){};export async function websiteVisitorStats(){return {}};export async function partyPackagesApi(action,payload){const r=await fetch('/test-party',{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.message);return d;}${helpers}`;
  await ctx.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/rest/v1/rpc/party_cart_items_api'){
      if(failCartBrowse){failCartBrowse=false;return route.fulfill({status:503,body:'Unavailable'});}
      const{p_action,p_payload}=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(cartResponse(p_action,p_payload))});
    }
    if(url.pathname==='/test-cart'){
      try{const{action,payload}=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(cartResponse(action,payload))});}
      catch(error){return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:error.message})});}
    }
    if(url.pathname==='/rest/v1/rpc/party_packages_api'){
      if(failBrowse){failBrowse=false;return route.fulfill({status:503,body:'Unavailable'});}
      const {p_action,p_payload}=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(response(p_action,p_payload))});
    }
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock+`export async function partyCartItemsApi(action,payload){const r=await fetch('/test-cart',{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.message);return d;}`});
    if(/\/assets\/ordering\/(traffic|newsletter)\.js/.test(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
    if(url.pathname==='/test-party'){
      try{const{action,payload}=route.request().postDataJSON();if(action==='delete'&&deleteGate)await deleteGate;return route.fulfill({contentType:'application/json',body:JSON.stringify(response(action,payload))});}
      catch(error){return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:error.message})});}
    }
    try{return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'}[extname(url.pathname)]||'application/octet-stream',body:await readFile(join(root,url.pathname))});}
    catch{return route.fulfill({status:404,body:'Not found'});}
  });
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  return ctx;
}
try{
  const ctx=await context(),page=await ctx.newPage();let acceptDialog=true,lastDialogMessage='';page.on('dialog',d=>{lastDialogMessage=d.message();return acceptDialog?d.accept():d.dismiss();});
  await page.goto(`${origin}/manage.html#packages`);await page.locator('[data-party-edit]').first().waitFor();
  assert.equal(await page.locator('[data-party-edit]').count(),4);
  assert.equal(await page.locator('[data-party-delete]').count(),4);
  await page.screenshot({path:join(output,'dashboard.png'),fullPage:true});
  await page.locator('[data-party-edit="package-1"]').click();
  await page.locator('[name="price"]').fill('9500.50');await page.locator('[name="subtitle"]').fill('Cookie party');
  await page.mouse.click(2,2);await page.keyboard.press('Escape');
  assert(await page.locator('.party-editor').evaluate(el=>el.open));assert.equal(await page.locator('[name="subtitle"]').inputValue(),'Cookie party');
  await page.locator('[data-feature-label]').first().fill('60 Cookie A La Mode');
  await page.locator('[data-feature-add]').click();await page.locator('[data-feature-label]').last().fill('Extra toppings');
  await page.locator('[data-feature-detail]').last().fill('Chocolate chips');await page.locator('[data-feature-up]').last().click();
  assert.deepEqual(await page.locator('[data-feature-label]').evaluateAll(nodes=>nodes.map(n=>n.value)),['60 Cookie A La Mode','Extra toppings','Choose 3 Flavors']);
  assert.match(await page.locator('[data-party-preview]').innerText(),/9,500.50/);
  await page.locator('.party-editor').evaluate(el=>el.scrollTop=0);await page.screenshot({path:join(output,'editor.png'),fullPage:true});
  failSave=true;await page.locator('[data-party-form] button[type="submit"]').click();await page.locator('[data-party-error]').filter({hasText:'Connection lost'}).waitFor();
  assert.equal(await page.locator('[name="price"]').inputValue(),'9500.50');
  await page.locator('[data-party-form] button[type="submit"]').click();await page.locator('.party-editor').waitFor({state:'hidden'});
  const saves=calls.filter(c=>c.action==='save');assert.equal(saves[0].payload.operation_id,saves[1].payload.operation_id);
  await page.reload();await page.locator('[data-view="packages"]').click();await page.locator('[data-party-edit="package-1"]').waitFor();assert.match(await page.locator('.party-admin-list').innerText(),/9,500.50/);
  await page.locator('[data-party-new]').click();await page.locator('[data-party-form] button[type="submit"]').click();assert.equal(items.length,4);
  await page.locator('[name="name"]').fill('New custom package');await page.locator('[name="price"]').fill('18000');await page.locator('[name="sort_order"]').fill('0');await page.locator('[data-feature-label]').fill('100 treats');await page.locator('[data-feature-detail]').fill('<img src=x onerror="window.injected=true">');
  assert.equal(await page.locator('[data-party-preview] img').count(),0);
  await page.locator('[data-party-form] button[type="submit"]').click();await page.locator('.party-editor').waitFor({state:'hidden'});assert.equal(items.length,5);assert.match(await page.locator('.party-admin-item').first().innerText(),/New custom package/);
  await page.locator('[data-party-edit="package-2"]').click();await page.locator('[name="published"]').uncheck();await page.locator('[data-party-form] button[type="submit"]').click();await page.locator('.party-editor').waitFor({state:'hidden'});
  await page.locator('[data-party-settings]').click();await page.locator('[data-feature-label]').first().fill('5 Hours Duration');await page.locator('[data-party-form] button[type="submit"]').click();await page.locator('.party-editor').waitFor({state:'hidden'});
  await page.locator('[data-party-cart]').click();await page.locator('[data-feature-label]').first().fill('Updated cookie treats');
  await page.locator('[data-feature-remove]').nth(1).click();await page.locator('[data-feature-add]').click();await page.locator('[data-feature-label]').last().fill('New custom treat');await page.locator('[data-feature-up]').last().click();
  assert.equal(await page.locator('[data-feature-detail]').count(),0);
  failCartSave=true;await page.locator('[data-party-form] button[type="submit"]').click();await page.locator('[data-party-error]').filter({hasText:'Cart changed'}).waitFor();assert.equal(await page.locator('[data-feature-label]').first().inputValue(),'Updated cookie treats');
  await page.locator('[data-party-form] button[type="submit"]').click();await page.locator('.party-editor').waitFor({state:'hidden'});
  const cartSaves=cartCalls.filter(c=>c.action==='save');assert.equal(cartSaves[0].payload.operation_id,cartSaves[1].payload.operation_id);
  assert.deepEqual(cart.items,['Updated cookie treats','New custom treat','Panna Cotta Cups']);
  await page.reload();await page.locator('[data-view="packages"]').click();await page.locator('[data-party-cart-list]').filter({hasText:'New custom treat'}).waitFor();
  await page.locator('[data-party-cart]').click();await page.locator('.party-editor').evaluate(el=>el.scrollTop=0);await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.fonts.check('14px "Chelsea Market"')));await page.screenshot({path:join(output,'customize-editor.png')});await page.locator('[data-party-close]').first().click();
  const publicPage=await ctx.newPage();await publicPage.goto(`${origin}/partycarts.html`);await publicPage.locator('.party-card').first().waitFor();assert.equal(await publicPage.locator('.party-card').count(),4);assert.equal(await publicPage.locator('.party-card h3').first().textContent(),'New custom package');assert(!(await publicPage.locator('[data-party-results]').innerText()).includes('Package 2'));
  assert.match(await publicPage.locator('.party-inclusions').innerText(),/5 Hours Duration/);
  await publicPage.locator('[data-party-cart-item]').first().waitFor();assert.deepEqual(await publicPage.locator('[data-party-cart-item]').allTextContents(),cart.items);
  assert.equal(await publicPage.locator('[data-party-cart-more] a').getAttribute('href'),'pastries.html');
  await publicPage.evaluate(()=>document.fonts.ready);assert.match(await publicPage.locator('.party-card h3').first().evaluate(el=>getComputedStyle(el).fontFamily),/Chelsea Market/);assert.match(await publicPage.locator('.party-price').first().evaluate(el=>getComputedStyle(el).fontFamily),/Chelsea Market/);
  assert.equal(await publicPage.locator('.party-features details, .party-features summary').count(),0);assert(await publicPage.locator('.party-feature-detail').first().isVisible());assert.equal(await publicPage.locator('[data-party-results] img').count(),0);assert.equal(await publicPage.evaluate(()=>window.injected),undefined);
  assert.equal(await publicPage.locator('.party-inquire').first().getAttribute('href'),'contactus.html');
  assert.match(await publicPage.locator('body').innerText(),/Customize your own cart!/i);
  await publicPage.locator('[data-party-packages]').screenshot({path:join(output,'public-packages.png')});
  const deleting=page.locator('[data-party-delete="package-4"]'),deleteBefore=calls.filter(c=>c.action==='delete').length;
  acceptDialog=false;await deleting.click();assert.match(lastDialogMessage,/Delete.*Package 4/);assert.match(lastDialogMessage,/cannot be undone/);
  assert.equal(calls.filter(c=>c.action==='delete').length,deleteBefore);assert.equal(await deleting.count(),1);
  acceptDialog=true;failDelete=true;await deleting.click();await page.locator('[data-party-message]').filter({hasText:'Could not delete'}).waitFor();assert.equal(await deleting.count(),1);assert(await deleting.isEnabled());
  let releaseDelete;deleteGate=new Promise(resolve=>{releaseDelete=resolve});await deleting.click();
  await page.locator('[data-party-message]').filter({hasText:'Deleting'}).waitFor();assert(await deleting.isDisabled());assert(await page.locator('[data-party-new]').isDisabled());
  await deleting.dispatchEvent('click');releaseDelete();deleteGate=null;
  await deleting.waitFor({state:'detached'});assert.equal(calls.filter(c=>c.action==='delete').length,deleteBefore+2);
  assert.equal(await page.locator('[data-party-edit]').count(),4);assert.match(await page.locator('[data-party-message]').innerText(),/Deleted.*Package 4/);
  assert(await page.locator('[data-party-edit]').evaluateAll(nodes=>nodes.includes(document.activeElement)));
  await page.reload();await page.locator('[data-party-edit]').first().waitFor();assert.equal(await page.locator('[data-party-delete="package-4"]').count(),0);
  await publicPage.reload();await publicPage.locator('.party-card').first().waitFor();assert.equal(await publicPage.locator('.party-card').count(),3);assert(!(await publicPage.locator('[data-party-results]').innerText()).includes('Package 4'));
  failBrowse=true;await publicPage.reload();await publicPage.locator('[data-party-retry]:not([hidden])').waitFor();assert.equal(await publicPage.locator('.party-card').count(),0);await publicPage.locator('[data-party-retry]').click();await publicPage.locator('.party-card').first().waitFor();
  failCartBrowse=true;await publicPage.reload();await publicPage.locator('[data-cart-retry]').waitFor();assert.equal(await publicPage.locator('[data-party-cart-item]').count(),0);await publicPage.locator('[data-cart-retry]').click();await publicPage.locator('[data-party-cart-item]').first().waitFor();
  const staff=await context({role:'staff'}),staffPage=await staff.newPage();const before=calls.filter(c=>c.action==='admin_list').length;
  const cartBefore=cartCalls.filter(c=>c.action==='admin_get').length;
  await staffPage.goto(`${origin}/manage.html`);await staffPage.locator('[data-view="packages"]').click();await staffPage.getByText('Sign in with the owner account to add or edit party packages.').waitFor();assert.equal(await staffPage.locator('[data-party-new]').count(),0);assert.equal(calls.filter(c=>c.action==='admin_list').length,before);assert.equal(cartCalls.filter(c=>c.action==='admin_get').length,cartBefore);
  assert.equal(await staffPage.locator('[data-party-delete]').count(),0);
  const mobile=await context({mobile:true}),phone=await mobile.newPage();phone.on('dialog',d=>d.accept());await phone.goto(`${origin}/manage.html`);await phone.locator('[data-view="packages"]').click();await phone.locator('[data-party-edit]').first().click();
  assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await phone.locator('.party-editor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await phone.screenshot({path:join(output,'editor-mobile.png'),fullPage:true});
  await phone.goto(`${origin}/partycarts.html`);await phone.locator('.party-card').first().waitFor();assert(await phone.locator('[data-party-packages]').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  assert.equal((await phone.locator('.cart-showcase-copy h1').innerText()).replace(/\s+/g,' ').trim(),'A cart full of happy moments.');assert(await phone.locator('.party-feature-detail').first().isVisible());
  await phone.locator('[data-party-packages]').screenshot({path:join(output,'public-mobile.png')});
  await page.locator('[data-party-cart]').click();while(await page.locator('[data-feature-remove]').count())await page.locator('[data-feature-remove]').first().click();assert(await page.locator('[data-feature-add]').isEnabled());await page.locator('[data-party-form] button[type="submit"]').click();await page.locator('.party-editor').waitFor({state:'hidden'});
  await publicPage.reload();await publicPage.getByText('Contact us to discuss treats for your custom cart.').waitFor();assert.equal(await publicPage.locator('[data-party-cart-item]').count(),0);
  items.forEach(p=>{p.published=false});await publicPage.reload();await publicPage.locator('[data-party-status]').filter({hasText:'updating our party packages'}).waitFor();assert.equal(await publicPage.locator('.party-card').count(),0);
  while(await page.locator('[data-party-delete]').count()){
    const button=page.locator('[data-party-delete]').first(),id=await button.getAttribute('data-party-delete');await button.click();await page.locator(`[data-party-delete="${id}"]`).waitFor({state:'detached'});
  }
  await page.getByText('No packages yet. Add your first package.').waitFor();assert(await page.locator('[data-party-new]').isEnabled());assert(await page.locator('[data-party-new]').evaluate(el=>el===document.activeElement));
  assert.deepEqual(errors,[]);console.log('PASS owner editing, retained drafts, retries, create, confirmed deletion/cancel/failure/busy/empty states, visibility, ordering, shared inclusions, public updates, escaped text, staff permissions and mobile layout.');
}finally{await browser.close();}
