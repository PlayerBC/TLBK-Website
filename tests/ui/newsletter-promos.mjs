import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://newsletter-promos.test',output=join(root,'test-results/newsletter-promos');
const now=Date.parse('2026-09-23T06:00:00Z');
const base={active:true,kind:'percent',value:5,min_subtotal_cents:30000,cap_cents:10000,global_limit:1,per_account_limit:1,issued_at:'2026-09-01T06:00:00Z',expires_at:'2026-10-01T06:00:00Z',sales_cents:0,discount_cents:0};
const welcomes=[base,{...base,expires_at:'2026-09-01T06:00:00Z'},{...base,reserved_count:1},{...base,redeemed_count:1,sales_cents:28500,discount_cents:1500},{...base,expires_at:new Date(now+60000).toISOString()}].map((p,i)=>({...p,id:'welcome'+i,code:'WELCOME-000000000000000'+i,email:'subscriber'+i+'@example.test'}));
const data={role:'owner',products:[],categories:[],orders:[],inventory:[],zones:[],staff:[],email_status:[],settings:{paused:false},newsletter_promos:welcomes,promos:[...welcomes,{...base,id:'regular',code:'MANUAL10',value:10,usage_count:0,redeemed_count:0,reserved_count:0}]};
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
export async function api(action){if(action==='admin_bootstrap')return {...${JSON.stringify(data)},role:window.testRole||'owner'};throw Error('Unexpected '+action)}
export async function upload(){throw Error('Unexpected upload')} export async function websiteVisitorStats(){return {}};${helpers}`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
await mkdir(output,{recursive:true});
try{
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
      if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
      const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
      try{return await route.fulfill({body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:now});await page.goto(origin+'/manage.html');
    await page.locator('[data-view="promos"]').click();
    await page.locator('#newsletter-promos-title').waitFor();
    assert.equal(await page.locator('#promo-results tbody tr').count(),1);
    assert.match(await page.locator('#promo-results').textContent(),/MANUAL10/);
    assert.doesNotMatch(await page.locator('#promo-results').textContent(),/WELCOME-/);
    assert.equal(await page.locator('#newsletter-promo-results tbody tr').count(),5);
    const metric=label=>page.locator('.newsletter-promo-metrics .panel').filter({has:page.locator('span',{hasText:new RegExp('^'+label+'$')})}).locator('strong');
    assert.equal(await metric('Codes issued').textContent(),'5');assert.equal(await metric('Active').textContent(),'2');assert.equal(await metric('Used').textContent(),'1');
    assert.equal(await metric('Reserved').textContent(),'1');assert.equal(await metric('Expired unused').textContent(),'1');
    assert.match(await metric('Product sales').textContent(),/285\.00/);assert.match(await metric('Discounts given').textContent(),/15\.00/);
    await page.locator('#newsletter-promos-title').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'newsletter-promos-'+width+'.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.clock.fastForward(61000);
    assert.equal(await metric('Active').textContent(),'1');assert.equal(await metric('Expired unused').textContent(),'2');
    assert.deepEqual(errors,[]);await context.close();
    console.log('PASS '+width+'px: regular/welcome separation, subscriber rows, analytics, expiry updates and mobile fit.');
  }
}finally{await browser.close()}
