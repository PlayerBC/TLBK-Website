// Exercise the real admin and storefront with local fixtures. No remote calls.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://daily-quantities.test';
const output=resolve(process.env.QUANTITY_TEST_OUTPUT||join(root,'tests/artifacts/daily-quantities'));
await mkdir(output,{recursive:true});
const key='daily-quantities-fixture',today='2026-09-19',next='2026-09-22';
const names=['Ube Cake (8″)','Tiramisu Basque (8″)','Krisp Nori Pouch','Mixed Cookie Box','Chocolate Cake','Archived Seasonal Bake'];
const initial={role:'owner',categories:[],orders:[],inventory:[],promos:[],zones:[],staff:[],email_status:[],
 settings:{paused:false,cutoff_time:null,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[]},
 products:names.map((name,i)=>({id:'product-'+i,name,price_cents:10000,lead_days:0,allow_same_day:true,min_quantity:1,active:i!==5,photos:i===5?[]:[`${origin}/photos/${i}.svg`],option_groups:[],sort_order:i}))};
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'local-owner'}}}}),onAuthStateChange:()=>{}};
const key=${JSON.stringify(key)},initial=${JSON.stringify(initial)};
const read=()=>JSON.parse(localStorage.getItem(key)||JSON.stringify(initial));
window.calls=[];
export async function api(action,payload={}){const data=read();window.calls.push({action,payload:structuredClone(payload)});
if(action==='admin_bootstrap'||action==='catalog')return structuredClone(data);
if(action==='save_inventory'){
 if(window.blockSave)await new Promise(resolve=>window.finishSave=resolve);
 if(window.failSave)throw Error('New order received: quantity cannot be below 4 already ordered.');
 for(const row of payload.rows){const index=data.inventory.findIndex(r=>r.product_id===row.product_id&&r.date===row.date);const reserved=data.inventory[index]?.reserved||0;const value={...row,reserved,remaining:row.capacity===null?null:row.capacity-reserved};if(index<0)data.inventory.push(value);else data.inventory[index]=value}
 localStorage.setItem(key,JSON.stringify(data));return structuredClone(data.inventory);
}throw Error('Unexpected API '+action)}
export async function upload(){throw Error('Uploads disabled')}
export async function websiteVisitorStats(){return {}}
${helpers}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
const result={checks:[],errors:[]},check=(name,ok)=>{result.checks.push({name,pass:Boolean(ok)});assert.ok(ok,name)};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}});
 await context.addInitScript(()=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-09-19T02:00:00Z']))}static now(){return new NativeDate('2026-09-19T02:00:00Z').getTime()}}});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
  if(['/assets/ordering/traffic.js','/assets/ordering/newsletter.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  if(url.pathname.startsWith('/photos/')){const i=Number(url.pathname.split('/').at(-1).split('.')[0]);return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#f2e7d6"/><ellipse cx="90" cy="134" rx="69" ry="20" fill="#e2d5c4"/><path d="M35 68h110v60c0 24-110 24-110 0z" fill="${['#8971a3','#6f4530','#48523b','#b07f51','#52352c'][i]}"/><ellipse cx="90" cy="68" rx="55" ry="20" fill="${['#b5a1c8','#b09072','#73844b','#d6b085','#966c52'][i]}"/></svg>`})}
  try{return route.fulfill({contentType:mime[extname(url.pathname)]||'application/octet-stream',body:await readFile(join(root,url.pathname))})}catch{return route.fulfill({status:404,body:'Not found'})}
 });
 const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
 const input=i=>page.locator(`[data-quantity-id="product-${i}"]`), day=d=>page.locator(`[data-calendar-date="${d}"]`);
 const save=()=>page.locator('[data-form="inventory"] button[type="submit"]');
 const open=async()=>{await page.goto(origin+'/manage.html',{waitUntil:'networkidle'});await page.locator('[data-view="inventory"]').first().click();await input(0).waitFor()};
 await open();
 check('All products are visible, including hidden products and a photo fallback',await page.locator('[data-quantity-product]').count()===6&&await page.locator('.quantity-photo img').count()===5&&await page.getByText('Hidden from menu',{exact:true}).count()===1);
 check('New date quantities start blank',await page.locator('[data-quantity-id]').evaluateAll(nodes=>nodes.every(n=>n.value==='')));
 check('Calendar selects today and disables historical days',await day(today).getAttribute('aria-pressed')==='true'&&await day('2026-09-18').isDisabled());
 await day(today).focus();await page.keyboard.press('ArrowLeft');
 check('Keyboard navigation keeps focus at the earliest allowed date',await page.locator(':focus').getAttribute('data-calendar-date')===today);
 await input(0).fill('5');await day(next).click();
 check('Date selection preserves the draft quantity',await input(0).inputValue()==='5');
 await input(2).fill('100');await save().click();
 await page.waitForFunction(()=>window.calls.filter(c=>c.action==='save_inventory').length===1);
 const first=await page.evaluate(()=>window.calls.find(c=>c.action==='save_inventory').payload.rows);
 check('Edited products apply the same total to each date, while untouched products stay unlimited',first.length===4&&first.filter(r=>r.product_id==='product-0').every(r=>r.capacity===5)&&first.filter(r=>r.product_id==='product-2').every(r=>r.capacity===100));
 check('Successful save clears all selected dates and waits for a fresh selection',await page.locator('[name="inventory_dates"]').inputValue()===''&&await page.locator('[data-calendar-date][aria-pressed="true"]').count()===0&&await input(0).isDisabled());
 check('Success message retains the number of saved dates',await page.getByText('Quantities saved for 2 selected dates.',{exact:true}).count()===1);
 await day(next).click();
 check('Next selection starts with only the newly chosen date and shows its saved limits',await page.locator('[name="inventory_dates"]').inputValue()===next&&await input(0).inputValue()==='5');
 await save().click();
 check('Saving unchanged quantities also deselects dates without an extra request',await page.locator('[name="inventory_dates"]').inputValue()===''&&await page.evaluate(()=>window.calls.filter(c=>c.action==='save_inventory').length)===1);
 await page.locator('#toast-region').evaluate(node=>node.replaceChildren());
 await page.screenshot({path:join(output,'desktop.png'),fullPage:true});
 await open();check('Saved limits reappear after reloading the page',await input(0).inputValue()==='5'&&await input(2).inputValue()==='100');
 await input(0).fill('');await save().click();
 await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).inventory.some(r=>r.product_id==='product-0'&&r.date==='2026-09-19'&&r.capacity===null),key);
 check('Clearing a saved field persists unlimited, not zero',await input(0).inputValue()==='');
 await day(today).click();await day(next).click();check('Different saved limits show Mixed',await input(0).getAttribute('placeholder')==='Mixed');
 await input(1).fill('8');await save().click();
 const mixed=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).inventory.filter(r=>r.product_id==='product-0'),key);
 check('Saving another product preserves untouched mixed limits',mixed.some(r=>r.capacity===5)&&mixed.some(r=>r.capacity===null));
 await day(today).click();await day(next).click();
 await page.locator('[data-action="unlimit-quantity"][data-id="product-0"]').click();await save().click();
 check('No limit clears every selected mixed date',await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).inventory.filter(r=>r.product_id==='product-0').every(r=>r.capacity===null),key));
 await day(today).click();await day(next).click();
 await input(3).fill('12');await page.locator('[data-calendar-move="1"]').click();await day('2026-10-02').focus();await page.keyboard.press('Space');
 check('Keyboard selection crosses months and retains edits',await day('2026-10-02').getAttribute('aria-pressed')==='true'&&await input(3).inputValue()==='12');
 await page.locator('[data-action="reset-quantities"]').click();check('Reset discards edits while preserving the date selection',await input(3).inputValue()===''&&await day('2026-10-02').getAttribute('aria-pressed')==='true');
 await input(3).fill('3');await page.evaluate(()=>{window.failSave=true;window.blockSave=true});await save().click();
 await page.waitForFunction(()=>Boolean(window.finishSave));
 check('Controls are locked during save',await input(3).isDisabled()&&await page.locator('[data-calendar-move="1"]').isDisabled());
 await page.evaluate(()=>window.finishSave());await page.getByRole('alert').filter({hasText:'New order received'}).waitFor();
 check('Failed saves retain selected dates and edits and restore editable controls',await input(3).inputValue()==='3'&&!await input(3).isDisabled()&&await page.locator('[name="inventory_dates"]').inputValue()===[today,next,'2026-10-02'].join('\n'));
 await input(3).fill('4');await page.evaluate(()=>{window.failSave=false;window.blockSave=false});await save().click();
 check('Retry saves the revised total',await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).inventory.filter(r=>r.product_id==='product-3').every(r=>r.capacity===4),key));
 await page.setViewportSize({width:390,height:844});
 check('Mobile layout has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#toast-region').evaluate(node=>node.replaceChildren());
 await page.screenshot({path:join(output,'mobile.png'),fullPage:true});
 check('Successful retry deselects dates across months',await page.locator('[name="inventory_dates"]').inputValue()==='');
 check('No selected dates disables product inputs',await input(0).isDisabled());await save().click();await page.getByRole('alert').filter({hasText:'Select at least one date'}).waitFor();
 await page.evaluate(key=>{const data=JSON.parse(localStorage.getItem(key));data.role='staff';localStorage.setItem(key,JSON.stringify(data))},key);await open();await input(4).fill('0');await save().click();
 check('Staff can set a zero total',await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).inventory.some(r=>r.product_id==='product-4'&&r.capacity===0),key));
 await page.goto(origin+'/shop.html',{waitUntil:'networkidle'});
 await page.locator('[data-product="product-0"]').first().click();
 check('Storefront finds an earliest date without a saved capacity row',!(await page.locator('#product-dialog').innerText()).includes('quantity not yet scheduled'));
 check('No uncaught browser errors',result.errors.length===0);
 await context.close();
}finally{await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));await browser.close()}
console.log(`Daily quantities browser checks passed: ${result.checks.length}`);
