// Exercise customer gestures locally, without orders, authentication or live APIs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://flavors.test';
const choice=(id,label,surcharge_cents=0)=>({id,label,surcharge_cents,active:true});
const fixture={categories:[],inventory:[],zones:[],settings:{paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],nonproduction_dates:[]},products:[{
  id:'box',name:'Box of 4 Chunkies',description:'Choose your favorites.',active:true,price_cents:55000,min_quantity:1,lead_days:1,photos:[],option_groups:[
    {id:'flavors',label:'Choose your flavor',required_count:4,choices:[choice('classic','Classic Chocochip'),choice('choco','Dark Choco Almond',1000),choice('matcha','Matchadamia',2000),choice('vanilla','Classic Vanilla'),{...choice('hidden','Unavailable'),active:false}]},
    {id:'extras',label:'Choose your extras',required_count:2,choices:[choice('caramel','Caramel',500),choice('chocolate','Chocolate')]},
    {id:'ribbon',label:'Choose a ribbon',required_count:1,choices:[choice('brown','Brown ribbon'),choice('rose','Rose ribbon',1000)]}
  ]
}]};
const realClient=await readFile(join(root,'assets/ordering/client.js'),'utf8');
const helpers=realClient.slice(realClient.indexOf('export function money('));
assert(helpers.startsWith('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth=null;
export async function api(action){if(action==='catalog')return ${JSON.stringify(fixture)};throw Error('Unexpected API: '+action)}
export async function upload(){throw Error('Unexpected upload')}
${helpers}`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
try{
  for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:740}]){
    const mobile=viewport.width<500;
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    const errors=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin){if(/supabase|resend/.test(url.hostname))errors.push('Live API attempted');return route.abort()}
      if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
      if(['/assets/ordering/newsletter.js','/assets/ordering/traffic.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
      const path=resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!path.startsWith(root+'/')&&!path.startsWith(root+'\\'))return route.abort();
      try{return await route.fulfill({contentType:mime[extname(path)]||'application/octet-stream',body:await readFile(path)})}catch{return route.fulfill({status:404,body:''})}
    });
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    const activate=locator=>mobile?locator.tap():locator.click();
    const input=id=>page.locator('.option-count[data-choice="'+id+'"]');
    const step=(id,delta)=>input(id).locator('..').locator('[data-option-delta="'+delta+'"]');
    const counter=id=>page.locator('[data-group-count="'+id+'"]');
    const total=async id=>page.locator('.option-count[data-group="'+id+'"]').evaluateAll(inputs=>inputs.reduce((sum,input)=>sum+Number(input.value),0));
    const assertFull=async()=>{
      assert.equal(await total('flavors'),4);
      assert.match(await counter('flavors').textContent(),/^4 of 4 selected/);
      for(const id of ['classic','choco','matcha','vanilla'])assert(await step(id,1).isDisabled());
    };
    await page.goto(origin+'/shop.html');
    await activate(page.locator('[data-product="box"]'));
    assert.equal(await page.locator('[data-choice="hidden"]').count(),0);
    assert(await step('classic',-1).isDisabled());
    assert.equal(await input('classic').getAttribute('max'),'4');
    await activate(step('classic',1));await activate(step('classic',1));await activate(step('choco',1));
    assert.equal(await input('matcha').getAttribute('max'),'1');
    // Typed/pasted values are capped by the remaining shared allowance.
    await input('matcha').fill('99');
    assert.equal(await input('matcha').inputValue(),'1');
    await assertFull();
    assert(await input('vanilla').isDisabled());
    assert(!(await input('classic').isDisabled()));
    assert(!(await step('classic',-1).isDisabled()));
    await step('vanilla',1).evaluate(button=>button.click());
    await input('choco').fill('99');
    await input('classic').press('ArrowUp');
    await assertFull();
    assert.equal(await input('choco').inputValue(),'1');
    assert.equal(await input('classic').inputValue(),'2');
    // Decreasing immediately unlocks every flavor; the next choice fills the cap.
    await activate(step('classic',-1));
    assert(!(await input('vanilla').isDisabled()));
    await activate(step('vanilla',1));
    await assertFull();
    await activate(step('matcha',-1));
    assert.equal(await total('flavors'),3);
    assert(await step('matcha',-1).isDisabled());
    // Other counted groups and single-choice radios remain independent.
    await input('caramel').fill('2');
    assert(await input('chocolate').isDisabled());
    assert.equal(await total('flavors'),3);
    await page.locator('[data-choice="brown"]').check();
    await page.locator('[data-choice="rose"]').check();
    assert(await page.locator('[data-choice="rose"]').isChecked());
    assert.equal(await counter('ribbon').textContent(),'1 of 1 selected');
    await input('classic').fill('-2');assert.equal(await input('classic').inputValue(),'0');
    await input('classic').fill('1.8');assert.equal(await input('classic').inputValue(),'1');
    await input('classic').fill('');await input('classic').blur();
    assert.equal(await input('classic').inputValue(),'0');
    await input('classic').fill('10');
    await assertFull();
    await page.locator('#product-quantity').fill('2');
    await assertFull();
    assert.match(await page.locator('#detail-price').textContent(),/580\.00/);
    assert.match(await page.locator('#add-to-cart').textContent(),/1,160\.00/);
    assert.equal(await page.locator('#product-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'No horizontal overflow');
    const overlaps=await page.locator('.option-choice').evaluateAll(rows=>rows.filter(row=>row.querySelector('label').getBoundingClientRect().right>row.querySelector('.option-choice-controls').getBoundingClientRect().left).length);
    assert.equal(overlaps,0,'Labels and quantity controls must not overlap');
    if(process.env.UI_SCREENSHOT_DIR){
      await mkdir(process.env.UI_SCREENSHOT_DIR,{recursive:true});
      await page.locator('#product-title').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(process.env.UI_SCREENSHOT_DIR,'flavor-limit-'+viewport.width+'.png')});
    }
    await activate(page.locator('#add-to-cart'));
    await page.locator('#product-dialog').waitFor({state:'hidden'});
    const cart=await page.evaluate(()=>JSON.parse(localStorage.getItem('tlb-checkout-v1')).items);
    assert.equal(cart.length,1);assert.equal(cart[0].quantity,2);assert.equal(cart[0].unit_price_cents,58000);
    assert.deepEqual(cart[0].selections,{flavors:{classic:2,choco:1,matcha:0,vanilla:1},extras:{caramel:2},ribbon:{rose:1}});
    await activate(page.locator('[data-product="box"]'));
    assert.equal(await total('flavors'),0);assert(!(await step('vanilla',1).isDisabled()));
    // Existing exact-count validation still protects incomplete selections.
    await activate(page.locator('#add-to-cart'));
    assert.match(await page.locator('#product-error').textContent(),/Choose exactly 4/);
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('PASS '+viewport.width+'px: shared caps, disabled controls, decrement/re-enable, manual entry, independent groups, pricing and cart.');
  }
}finally{await browser.close()}
