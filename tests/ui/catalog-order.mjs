// Real browser gestures and dashboard integration; all data is local fixture data.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://catalog.test',output=join(root,'test-results/catalog-order');
await mkdir(output,{recursive:true});
const initial={role:'owner',orders:[],inventory:[],promos:[],zones:[],staff:[],settings:{paused:false},categories:[{id:'cake',name:'Cakes',sort_order:1},{id:'cookie',name:'Cookies',sort_order:2},{id:'snack',name:'Snacks',sort_order:3}],products:['Ube cake','Chocolate cake','Vanilla cake','Mini cake','Cookie box','Nori pouch','Brownies'].map((name,i)=>({id:'p'+i,name,description:'Keep these details',price_cents:10000+i*1000,min_quantity:1,lead_days:1,category_id:['cake','cake','cake','cake','cookie','snack',null][i],active:i!==3,photos:[origin+'/photo.svg'],option_groups:[],sort_order:i+1}))};
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
const initial=${JSON.stringify(initial)}; const read=()=>JSON.parse(localStorage.getItem('catalog')||JSON.stringify(initial));
export async function api(action,payload={}) {const data=read();if(action==='admin_bootstrap')return data;
window.calls??=[];window.calls.push({action,payload});if(data.role!=='owner')throw Error('Owner required');
if(window.failOrder){window.failOrder=false;throw Error('Connection lost. Please retry.');}
if(window.holdOrder)await new Promise(resolve=>window.releaseOrder=resolve);
if(action==='reorder_catalog'){const before=data[payload.kind];data[payload.kind]=payload.ids.map((id,i)=>({...before.find(x=>x.id===id),sort_order:i+1}));localStorage.setItem('catalog',JSON.stringify(data));return {items:data[payload.kind]};}
if(action==='save_category'||action==='save_product'){if(payload.preserve_order!==true)throw Error('Missing preserve_order');const kind=action==='save_category'?'categories':'products',item=payload.category||payload.product,existing=data[kind].find(x=>x.id===item.id);const saved={...item,id:item.id||'new-item',sort_order:existing?.sort_order??Math.max(0,...data[kind].map(x=>x.sort_order))+1};if(existing)Object.assign(existing,saved);else data[kind].push(saved);localStorage.setItem('catalog',JSON.stringify(data));return saved;}
throw Error('Unexpected '+action);}
export async function upload(){} export async function websiteVisitorStats(){return {}};${helpers}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH}),errors=[];
async function context(mobile=false) {
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1000},isMobile:mobile,hasTouch:mobile});
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
  if(/\/(traffic|newsletter)\.js$/.test(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  if(u.pathname==='/photo.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#c8b1d7"/><circle cx="50" cy="50" r="32" fill="#755387"/></svg>'});
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
  try{return route.fulfill({contentType:mime[extname(u.pathname)]||'application/octet-stream',body:await readFile(join(root,u.pathname))});}catch{return route.fulfill({status:404,body:''});}
 });
 ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));return ctx;
}
const ids=page=>page.locator('.catalog-order-list [data-order-id]').evaluateAll(rows=>rows.map(row=>row.dataset.orderId));
async function menu(page){await page.goto(origin+'/manage.html');await page.locator('[data-view="products"]').first().click();await page.locator('[data-action="reorder-products"]').waitFor();}
async function drag(page,from,to,touch=false,cancel=false,group=0){
 const handle=page.locator(`[data-order-group="${group}"] [data-order-handle="${from}"]`),target=page.locator(`[data-order-group="${group}"] [data-order-item="${to}"]`);await handle.scrollIntoViewIfNeeded();
 const a=await handle.boundingBox(),b=await target.boundingBox(),start={x:a.x+a.width/2,y:a.y+a.height/2},end={x:b.x+30,y:b.y+b.height/2};
 if(touch){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/12,y:start.y+(end.y-start.y)*i/12}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();}
}
try{
 const ctx=await context(),page=await ctx.newPage();let accept=false;page.on('dialog',d=>accept?d.accept():d.dismiss());await menu(page);
 await page.locator('[data-product-filter="search"]').fill('Ube');assert.equal(await page.locator('.product-card').count(),1);
 await page.locator('[data-action="reorder-products"]').click();assert.deepEqual(await ids(page),['p0','p1','p2','p3','p4','p5','p6']);
 const first=await page.locator('[data-order-group="0"] [data-order-handle="0"]').boundingBox(),other=await page.locator('[data-order-group="1"] [data-order-item="0"]').boundingBox();await page.mouse.move(first.x+20,first.y+20);await page.mouse.down();await page.mouse.move(other.x+20,other.y+20,{steps:10});await page.mouse.up();assert.deepEqual(await ids(page),['p0','p1','p2','p3','p4','p5','p6']);
 await drag(page,0,2);assert.deepEqual(await ids(page),['p1','p2','p0','p3','p4','p5','p6']);
 await page.locator('[data-order-group="0"] [data-order-handle="2"]').press('Home');assert.deepEqual(await ids(page),['p0','p1','p2','p3','p4','p5','p6']);
 await drag(page,0,2,false,true);assert.deepEqual(await ids(page),['p0','p1','p2','p3','p4','p5','p6']);
 await page.locator('[data-order-group="0"] [data-order-handle="0"]').press('End');assert.deepEqual(await ids(page),['p1','p2','p3','p0','p4','p5','p6']);
 await page.locator('#dialog-close').click();assert(await page.locator('#admin-dialog').isVisible());
 await page.keyboard.press('Escape');assert(await page.locator('#admin-dialog').isVisible());
 await page.screenshot({path:join(output,'products-desktop.png')});
 await page.evaluate(()=>window.failOrder=true);await page.locator('[data-order-save]').click();await page.locator('[data-order-status]').filter({hasText:'Connection lost'}).waitFor();assert.deepEqual(await ids(page),['p1','p2','p3','p0','p4','p5','p6']);
 await page.evaluate(()=>window.holdOrder=true);await page.locator('[data-order-save]').click();await page.locator('[data-order-status]').filter({hasText:'Saving order'}).waitFor();await page.locator('#dialog-close').click();assert(await page.locator('#admin-dialog').isVisible());
 await page.evaluate(()=>{window.holdOrder=false;window.releaseOrder();});await page.locator('[data-order-status]').filter({hasText:'Order saved.'}).waitFor();
 const calls=await page.evaluate(()=>window.calls.filter(x=>x.action==='reorder_catalog'));assert.deepEqual(calls[0].payload,calls[1].payload);assert.equal(calls.length,2);
 await page.locator('#dialog-close').click();await menu(page);await page.locator('[data-action="reorder-products"]').click();assert.deepEqual(await ids(page),['p1','p2','p3','p0','p4','p5','p6']);await page.locator('#dialog-close').click();
 await page.locator('[data-action="categories"]').click();await drag(page,2,0);assert.deepEqual(await ids(page),['snack','cake','cookie']);
 await page.locator('[data-action="edit-category"]').first().click();assert(await page.locator('#catalog-order-editor').isVisible()); // Decline discarding unsaved order.
 await page.locator('[data-order-save]').click();await page.locator('[data-order-status]').filter({hasText:'Order saved.'}).waitFor();
 await page.screenshot({path:join(output,'categories-desktop.png')});
 await page.locator('#dialog-close').click();await page.locator('[data-action="reorder-products"]').click();assert.deepEqual(await page.locator('.catalog-order-group>h3').allTextContents(),['Snacks','Cakes','Cookies','Uncategorized']);assert.deepEqual(await ids(page),['p5','p1','p2','p3','p0','p4','p6']);assert(await page.locator('[data-order-group="0"] [data-order-handle]').isDisabled());await page.locator('#dialog-close').click();await page.locator('[data-action="categories"]').click();
 await page.locator('[data-action="edit-category"]').first().click();assert.equal(await page.locator('[name="sort_order"]').count(),0);await page.locator('[name="name"]').fill('Savory snacks');await page.locator('form[data-form="category"] button[type="submit"]').click();
 await page.locator('#admin-dialog').waitFor({state:'hidden'});await page.locator('[data-action="categories"]').click();assert.deepEqual(await ids(page),['snack','cake','cookie']);
 await page.locator('[data-action="new-category"]').click();await page.locator('[name="name"]').fill('New category');await page.locator('form[data-form="category"] button[type="submit"]').click();await page.locator('#admin-dialog').waitFor({state:'hidden'});await page.locator('[data-action="categories"]').click();assert.deepEqual(await ids(page),['snack','cake','cookie','new-item']);await page.locator('#dialog-close').click();
 await page.locator('[data-action="edit-product"]').first().click();assert.equal(await page.locator('[name="sort_order"]').count(),0);await page.locator('form[data-form="product"] button[type="submit"]').click();await page.locator('#admin-dialog').waitFor({state:'hidden'});
 assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('catalog')))).products[0].sort_order,1);
 const mobile=await context(true),phone=await mobile.newPage();phone.on('dialog',d=>d.accept());await menu(phone);await phone.locator('[data-action="reorder-products"]').click();await drag(phone,1,0,true);assert.deepEqual(await ids(phone),['p1','p0','p2','p3','p4','p5','p6']);
 assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:join(output,'products-mobile.png')});await phone.locator('[data-order-reset]').click();assert.deepEqual(await ids(phone),['p0','p1','p2','p3','p4','p5','p6']);await phone.locator('#dialog-close').click();
 await phone.locator('[data-action="categories"]').click();await drag(phone,2,0,true);assert.deepEqual(await ids(phone),['snack','cake','cookie']);await phone.screenshot({path:join(output,'categories-mobile.png')});
 const long=await ctx.newPage();await long.goto(origin+'/manage.html');await long.evaluate(initial=>localStorage.setItem('catalog',JSON.stringify({...initial,products:Array.from({length:20},(_,i)=>({...initial.products[0],id:'long'+i,name:'Treat '+i,sort_order:i+1}))})),initial);await menu(long);await long.locator('[data-action="reorder-products"]').click();
 const grip=await long.locator('[data-order-group="0"] [data-order-handle="0"]').boundingBox(),dialog=await long.locator('#admin-dialog').boundingBox();await long.mouse.move(grip.x+20,grip.y+20);await long.mouse.down();await long.mouse.move(grip.x+20,dialog.y+dialog.height-18,{steps:15});await long.waitForFunction(()=>document.querySelector('#admin-dialog').scrollTop>100);await long.keyboard.press('Escape');await long.mouse.up();assert.equal((await ids(long))[0],'long0');assert.equal(await long.locator('.catalog-order-ghost').count(),0);
 await long.locator('[data-order-group="0"] [data-order-handle="0"]').press('End');assert.equal((await ids(long)).at(-1),'long0');await long.locator('[data-order-reset]').click();assert.equal((await ids(long))[0],'long0');
 await long.locator('#dialog-close').click();await long.evaluate(initial=>localStorage.setItem('catalog',JSON.stringify({...initial,products:[],categories:[]})),initial);await menu(long);await long.locator('[data-action="categories"]').click();assert.equal(await long.locator('[data-order-handle]').count(),0);assert(await long.locator('[data-order-save]').isDisabled());
 const staff=await ctx.newPage();await staff.goto(origin+'/manage.html');await staff.evaluate(initial=>localStorage.setItem('catalog',JSON.stringify({...initial,role:'staff'})),initial);await menu(staff);assert(await staff.locator('[data-action="reorder-products"]').isDisabled());await staff.locator('[data-action="categories"]').click();assert.equal(await staff.locator('[data-order-handle]:enabled').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS product/category mouse, touch and keyboard reordering; cancel/reset; save retry and busy/dirty guards; filters; saved reload; ordinary edits retain order; new categories append; staff denial; mobile layout.');
}finally{await browser.close();}
