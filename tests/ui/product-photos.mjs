// Exercise real mouse, keyboard and touch gestures against the product editor.
// APIs and uploads are local fixtures; no production requests are allowed.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.PHOTO_TEST_OUTPUT || join(root, 'tests/artifacts/product-photos'));
await mkdir(output, {recursive: true});
const origin = 'https://photo-order.test';
const photo = number => `${origin}/photos/${number}.svg`;
const key = 'product-photo-order-fixture';
const initial = {
  role: 'owner', categories: [], orders: [], inventory: [], promos: [], zones: [], staff: [], email_status: [],
  settings: {paused: false, production_weekdays: [0,1,2,3,4,5,6], fulfillment_weekdays: [0,1,2,3,4,5,6]},
  products: [{id:'cake', name:'Ube cake', description:'Local photo-order fixture', price_cents:225000, min_quantity:1,
    lead_days:2, sort_order:0, active:true, pickup_only:true, photos:[1,2,3,4,5].map(photo),
    option_groups:[{id:'flavor',label:'Flavor',required_count:1,choices:[{id:'ube',label:'Ube',surcharge_cents:0,active:true}]}]}],
};
const client = await readFile(join(root,'assets/ordering/client.js'),'utf8');
const helpers = client.slice(client.indexOf('export function money('));
const mock = `export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'local-owner'}}}}),onAuthStateChange:()=>{}};
const key=${JSON.stringify(key)},initial=${JSON.stringify(initial)};
const read=()=>JSON.parse(localStorage.getItem(key)||JSON.stringify(initial));
export async function api(action,payload={}){const data=read();if(action==='admin_bootstrap'||action==='catalog')return data;
if(action==='save_product'){if(data.role!=='owner')throw Error('Owner required');const saved=structuredClone(payload.product);data.products[0]=saved;localStorage.setItem(key,JSON.stringify(data));window.photoSaveCount=(window.photoSaveCount||0)+1;return saved}throw Error('Unexpected API '+action)}
export async function upload(){if(window.blockPhotoUpload)await new Promise(resolve=>{window.finishPhotoUpload=resolve});return {url:'${photo('uploaded')}'}}
export async function websiteVisitorStats(){return {}}
${helpers}`;
const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
const result = {checks:[],errors:[]};
const check = (name,ok) => {result.checks.push({name,pass:Boolean(ok)});assert.ok(ok,name)};
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
async function context(options={}) {
  const ctx=await browser.newContext({viewport:{width:1280,height:1000},...options});
  await ctx.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
    if(['/assets/ordering/traffic.js','/assets/ordering/newsletter.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
    if(url.pathname.startsWith('/photos/')){
      const label=url.pathname.split('/').at(-1).replace('.svg','');
      const colors={1:'#866199',2:'#bb93b8',3:'#cfb79d',4:'#968ea6',5:'#726894',uploaded:'#b98367'};
      return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="${colors[label]||'#866199'}"/><text x="90" y="105" text-anchor="middle" font-size="40" font-family="sans-serif" fill="white">${label==='uploaded'?'New':label}</text></svg>`});
    }
    try{return await route.fulfill({contentType:mime[extname(url.pathname)]||'application/octet-stream',body:await readFile(join(root,url.pathname))})}catch{return route.fulfill({status:404,body:'Not found'})}
  });
  return ctx;
}
async function openEditor(page) {
  await page.goto(`${origin}/manage.html`,{waitUntil:'networkidle'});
  await page.locator('[data-view="products"]').first().click();
  await page.locator('[data-action="edit-product"]').first().click();
  await page.locator('.photo-list').scrollIntoViewIfNeeded();
}
const order = page => page.locator('.photo-list img').evaluateAll(images=>images.map(img=>img.getAttribute('src')));
async function points(page,from,to) {
  await page.locator('.photo-list').scrollIntoViewIfNeeded();
  const a=await page.locator(`[data-photo-move="${from}"]`).boundingBox();
  const b=await page.locator(`[data-photo-move="${to}"]`).boundingBox();
  return [{x:a.x+a.width/2,y:a.y+a.height/2},{x:b.x+b.width/2,y:b.y+b.height/2}];
}
async function mouseDrag(page,from,to,{cancel=false,outside=false}={}) {
  const [a,b]=await points(page,from,to);
  await page.mouse.move(a.x,a.y);await page.mouse.down();
  await page.mouse.move(b.x,outside?b.y-130:b.y,{steps:12});
  if(cancel)await page.keyboard.press('Escape');
  await page.mouse.up();
}
async function touchDrag(page,from,to,cancel=false) {
  const [a,b]=await points(page,from,to),cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
  for(let step=1;step<=10;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*step/10,y:a.y+(b.y-a.y)*step/10}]});
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  await cdp.detach();
}
async function save(page) {
  await page.locator('[data-form="product"] button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#admin-dialog').open);
}
async function editorStability(page, mobile=false) {
  await page.locator('[name="name"]').fill('Keep my unfinished product');
  await page.locator('[name="description"]').fill('Keep my unfinished description');
  if (mobile) await page.touchscreen.tap(2,2); else await page.mouse.click(2,2);
  await page.keyboard.press('Escape');
  check(`${mobile?'Mobile':'Desktop'} outside clicks and Escape keep the editor and draft open`,await page.locator('#admin-dialog').evaluate(el=>el.open) && await page.locator('[name="name"]').inputValue()==='Keep my unfinished product');
  const inOptions=async()=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert(await page.locator('#admin-dialog').evaluate(el=>el.scrollTop>200),'Options stay in view instead of jumping to the top');
    assert.equal(await page.locator('[name="description"]').inputValue(),'Keep my unfinished description');
  };
  await page.locator('[data-action="add-choice"][data-index="0"]').click();await inOptions();
  assert(await page.locator('[name="choice_label_0_1"]').evaluate(el=>el===document.activeElement));
  await page.locator('[data-action="remove-choice"][data-group="0"][data-index="1"]').click();await inOptions();
  await page.locator('[data-action="remove-choice"][data-group="0"][data-index="0"]').click();await inOptions();
  assert(await page.locator('[data-action="add-choice"][data-index="0"]').evaluate(el=>el===document.activeElement));
  await page.locator('[data-action="add-group"]').click();await inOptions();
  assert(await page.locator('[name="group_label_1"]').evaluate(el=>el===document.activeElement));
  await page.locator('[data-action="remove-group"][data-index="1"]').click();await inOptions();
  await page.locator('[data-action="remove-group"][data-index="0"]').click();await inOptions();
  await page.locator('[data-action="add-group"]').click();await inOptions();
  check(`${mobile?'Mobile':'Desktop'} adding/deleting choices and groups retains the options area, focus and unsaved fields`,true);
  await page.locator('[data-action="close-dialog"]').click();assert(!(await page.locator('#admin-dialog').evaluate(el=>el.open)));
  await openEditor(page);
}
try {
  const desktop=await context(),page=await desktop.newPage();
  page.on('pageerror',error=>result.errors.push(error.message));
  await openEditor(page);
  await editorStability(page);
  await page.locator('[name="name"]').fill('Ube cake edited');
  await page.locator('[name="description"]').fill('Keep these unsaved details');
  await page.locator('[name="group_label_0"]').fill('Choose your flavor');
  await mouseDrag(page,4,0);
  assert.deepEqual(await order(page),[5,1,2,3,4].map(photo));
  check('Dragging a photo to the front updates the draft order and cover badge',await page.locator('.photo-tile').first().locator('.photo-position').innerText()==='Cover');
  check('Reordering preserves unsaved text and option edits',await page.locator('[name="name"]').inputValue()==='Ube cake edited' && await page.locator('[name="description"]').inputValue()==='Keep these unsaved details' && await page.locator('[name="group_label_0"]').inputValue()==='Choose your flavor');
  check('Dragging alone does not publish the product',await page.evaluate(()=>!window.photoSaveCount));
  await page.locator('[data-photo-move="0"]').press('ArrowRight');
  assert.deepEqual(await order(page),[1,5,2,3,4].map(photo));
  check('Arrow keys move a photo and retain keyboard focus',await page.locator('[data-photo-move="1"]').evaluate(el=>el===document.activeElement));
  await page.locator('[data-photo-move="1"]').press('End');
  await page.locator('[data-photo-move="4"]').press('Home');
  assert.deepEqual(await order(page),[5,1,2,3,4].map(photo));
  check('Home and End move to the first and last positions',await page.locator('#photo-order-status').innerText()==='Photo moved to position 1 of 5. This is the menu cover.');
  await mouseDrag(page,0,2,{cancel:true});
  assert.deepEqual(await order(page),[5,1,2,3,4].map(photo));
  check('Escape cancels the drag while keeping the editor open',await page.locator('#admin-dialog').evaluate(el=>el.open) && await page.locator('.photo-drag-preview').count()===0);
  await mouseDrag(page,0,2,{outside:true});
  assert.deepEqual(await order(page),[5,1,2,3,4].map(photo));
  check('Dropping outside the photos leaves their order unchanged',await page.locator('.photo-drop-target').count()===0);
  await page.locator('#product-photo-order').screenshot({path:join(output,'product-photo-order-desktop.png')});
  await save(page);
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).products[0],key);
  assert.deepEqual(saved.photos,[5,1,2,3,4].map(photo));
  check('Save persists photo order together with other product edits',saved.name==='Ube cake edited' && saved.option_groups[0].label==='Choose your flavor');
  await openEditor(page);
  assert.deepEqual(await order(page),saved.photos);
  check('Reopening the editor restores the saved order',true);
  await page.locator('[data-action="remove-photo"][data-index="1"]').click();
  assert.deepEqual(await order(page),[5,2,3,4].map(photo));
  await page.evaluate(()=>{window.blockPhotoUpload=true});
  await page.locator('#product-photos').setInputFiles({name:'new-photo.png',mimeType:'image/png',buffer:Buffer.from('fixture')});
  await page.waitForFunction(()=>typeof window.finishPhotoUpload==='function');
  await mouseDrag(page,3,0);
  assert.deepEqual(await order(page),[5,2,3,4].map(photo));
  check('Photo ordering cannot race an upload while saving is disabled',await page.locator('[data-form="product"] button[type="submit"]').isDisabled());
  await page.evaluate(()=>window.finishPhotoUpload());
  await page.waitForFunction(()=>document.querySelectorAll('.photo-list img').length===5);
  await mouseDrag(page,4,0);
  assert.deepEqual(await order(page),['uploaded',5,2,3,4].map(photo));
  await save(page);
  check('New uploads can be reordered and removing a reordered photo removes the correct image',true);
  await openEditor(page);
  await mouseDrag(page,0,3);
  await page.locator('#dialog-close').click();
  await page.locator('[data-action="edit-product"]').first().click();
  assert.deepEqual(await order(page),['uploaded',5,2,3,4].map(photo));
  check('Closing without saving discards photo-order changes',true);
  await page.goto(`${origin}/shop.html`,{waitUntil:'networkidle'});
  check('The saved first photo becomes the customer menu cover',await page.locator('[data-product="cake"] img').first().getAttribute('src')===photo('uploaded'));

  const mobile=await context({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),touchPage=await mobile.newPage();
  touchPage.on('pageerror',error=>result.errors.push(error.message));
  await openEditor(touchPage);
  await editorStability(touchPage,true);
  await touchDrag(touchPage,4,0);
  assert.deepEqual(await order(touchPage),[5,1,2,3,4].map(photo));
  check('Native touch dragging reorders across wrapped rows',true);
  await touchDrag(touchPage,0,2,true);
  assert.deepEqual(await order(touchPage),[5,1,2,3,4].map(photo));
  check('Interrupted touch gestures do not change the draft',await touchPage.locator('.photo-drag-preview').count()===0);
  await touchPage.locator('#product-photo-order').screenshot({path:join(output,'product-photo-order-mobile.png')});
  await save(touchPage);
  await openEditor(touchPage);
  assert.deepEqual(await order(touchPage),[5,1,2,3,4].map(photo));
  check('Touch reorder persists after saving and reopening',true);
  await touchPage.setViewportSize({width:320,height:844});
  await touchDrag(touchPage,4,0);
  assert.deepEqual(await order(touchPage),[4,5,1,2,3].map(photo));
  check('Reordering also works at 320px without horizontal overflow',await touchPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto(`${origin}/manage.html`,{waitUntil:'networkidle'});
  await page.evaluate(({key,initial,origin})=>localStorage.setItem(key,JSON.stringify({...initial,products:[{...initial.products[0],photos:Array.from({length:12},(_,i)=>`${origin}/photos/${i+1}.svg`)}]})),{key,initial,origin});
  await page.setViewportSize({width:320,height:700});
  await openEditor(page);
  await page.locator('[data-photo-move="0"]').scrollIntoViewIfNeeded();
  const first=await page.locator('[data-photo-move="0"]').boundingBox(),dialog=await page.locator('#admin-dialog').boundingBox();
  const beforeScroll=await page.locator('#admin-dialog').evaluate(el=>el.scrollTop);
  await page.mouse.move(first.x+45,first.y+45);await page.mouse.down();
  await page.mouse.move(first.x+45,dialog.y+dialog.height-15,{steps:10});
  await page.waitForFunction(before=>document.querySelector('#admin-dialog').scrollTop>before+40,beforeScroll);
  await page.keyboard.press('Escape');await page.mouse.up();
  check('Dragging near the editor edge scrolls a twelve-photo list',true);
  await page.locator('[data-photo-move="0"]').scrollIntoViewIfNeeded();
  const [gapSource]=await points(page,3,0),gapTarget=await page.locator('[data-photo-move="0"]').boundingBox();
  await page.mouse.move(gapSource.x,gapSource.y);await page.mouse.down();
  await page.mouse.move(gapTarget.x+gapTarget.width+2,gapTarget.y+45,{steps:10});await page.mouse.up();
  check('Dropping in the gap next to a photo uses the nearest position',(await order(page))[0]===photo(4));
  await desktop.close();await mobile.close();

  const staff=await context(),staffPage=await staff.newPage();
  await staffPage.goto(`${origin}/manage.html`,{waitUntil:'networkidle'});
  await staffPage.evaluate(({key,initial})=>localStorage.setItem(key,JSON.stringify({...initial,role:'staff'})),{key,initial});
  await openEditor(staffPage);
  check('Staff view cannot reorder or remove product photos',await staffPage.locator('.photo-list button:enabled').count()===0);
  await staffPage.evaluate(({key,initial})=>localStorage.setItem(key,JSON.stringify({...initial,products:[{...initial.products[0],photos:[initial.products[0].photos[0]]}]})),{key,initial});
  await openEditor(staffPage);
  check('One photo remains the cover with reordering disabled',await staffPage.locator('[data-photo-move="0"]').isDisabled() && await staffPage.locator('.photo-position').innerText()==='Cover');
  await staff.close();
  check('No browser JavaScript errors',result.errors.length===0);
} catch(error) { result.error=error.stack;process.exitCode=1; }
finally {await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();}
