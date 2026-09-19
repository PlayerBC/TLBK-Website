// Browser coverage for consent, private-link handling, account preferences and
// the once-only invitation. All auth and newsletter calls are mocked locally.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '..');
const mockClient = `
export const ready = Promise.resolve(), configured = true, initializationError = null, authLink = {};
export const auth = {
 getSession: async () => { window.authReads = (window.authReads || 0) + 1; return {data:{session:window.testUser ? {user:window.testUser,access_token:'local-test-session'} : null}}; },
 getUser: async () => ({data:{user:window.testUser || null}}),
 signUp: async () => { window.signupCalls = (window.signupCalls || 0) + 1; return {data:{session:null}}; },
 onAuthStateChange: () => ({}), signOut: async () => ({error:null}),
};
export async function api(action) { if(action==='my_orders') return []; throw new Error('No staff access in this fixture'); }
export const escapeHtml = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money = x => String(x), formatDate = x => String(x), toast = () => {};
`;
const mockShop = `document.getElementById('app').innerHTML='<section class="shop-hero"><div class="hero-copy"><h1>Freshly baked for you.</h1></div></section><button id="open-product">Product</button><button id="open-checkout">Checkout</button>'; document.getElementById('open-product').onclick=()=>document.getElementById('product-dialog').showModal(); document.getElementById('open-checkout').onclick=()=>document.getElementById('checkout-dialog').showModal();`;
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (name === '/assets/ordering/client.js') { res.writeHead(200, {'Content-Type':'text/javascript'}); res.end(mockClient); return; }
    if (name === '/assets/ordering/shop.js') { res.writeHead(200, {'Content-Type':'text/javascript'}); res.end(mockShop); return; }
    if (name === '/assets/ordering/traffic.js') { res.writeHead(200, {'Content-Type':'text/javascript'}); res.end(''); return; }
    const path = resolve(root, '.' + name);
    if (!path.startsWith(root + sep)) throw new Error('Bad path');
    const body = await readFile(path);
    res.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream'}); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], forbidden = [], claims = new Set();
let browser;
try {
  browser = await chromium.launch({ executablePath:process.env.BROWSER_EXECUTABLE_PATH || undefined, headless:true });
  async function fixture({ user = null, initial = 'not_subscribed', failSubscribe = false, storageBlocked = false } = {}) {
    const state = {status:initial, failSubscribe, calls:[]};
    const context = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:'block'});
    await context.addInitScript(({user}) => { window.testUser = user; }, {user});
    if (storageBlocked) await context.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage disabled in this test'); } }); });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.pathname === '/functions/v1/newsletter') {
        const body = route.request().postDataJSON(); state.calls.push(body);
        let response = {ok:true};
        if (body.action === 'status') response = {status:state.status,email:user?.email};
        if (body.action === 'popup_claim') { response = {show:!claims.has(user?.id)}; claims.add(user?.id); }
        if (body.action === 'popup_seen') claims.add(user?.id);
        if (body.action === 'subscribe') {
          if (state.failSubscribe) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Please try again shortly.'})});
          state.status = 'subscribed'; response.status = state.status;
        }
        if (body.action === 'confirm') { state.status = 'subscribed'; response.status = state.status; }
        if (body.action === 'unsubscribe') { state.status = 'unsubscribed'; response.status = state.status; }
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
      }
      // Original homepage has third-party fonts/bootstrap. Block them; none are
      // required for newsletter behavior, and no live service can be reached.
      if (!['fonts.googleapis.com','fonts.gstatic.com','cdn.jsdelivr.net','www.googletagmanager.com'].includes(url.hostname)) forbidden.push(url.href);
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    return {context,page,state};
  }
  const advance = async page => { await page.waitForFunction(() => window.authReads > 0); await page.clock.fastForward(5100); };
  let f = await fixture();
  await f.page.goto(origin + '/shop.html'); await advance(f.page);
  await f.page.locator('#newsletter-dialog').waitFor({state:'visible'});
  assert.equal(await f.page.evaluate(() => localStorage.getItem('tlb-newsletter-popup-shown')), 'true', 'Mark shown immediately, before dismissal');
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Popup fits mobile width');
  await mkdir(join(root,'work'),{recursive:true});
  await f.page.screenshot({path:join(root,'work/newsletter-popup-mobile.png'),fullPage:true});
  await f.page.keyboard.press('Escape');
  await f.page.locator('#newsletter-dialog').waitFor({state:'detached'});
  assert.equal(await f.page.locator('#newsletter-dialog').count(),0);
  await f.page.reload(); await advance(f.page);
  assert.equal(await f.page.locator('#newsletter-dialog').count(),0,'No repeat after reload');
  await f.context.close();

  f = await fixture();
  await f.page.goto(origin + '/shop.html'); await f.page.locator('#open-checkout').click(); await advance(f.page);
  assert.equal(await f.page.locator('#newsletter-dialog').count(),0,'Never overlap checkout');
  await f.page.evaluate(() => document.getElementById('checkout-dialog').close());
  await f.page.locator('#newsletter-dialog').waitFor({state:'visible'});
  await f.page.locator('#newsletter-popup-email').fill('subscriber@example.test');
  await f.page.locator('#newsletter-dialog button[type=submit]').click();
  await f.page.getByText('Subscribed',{exact:true}).waitFor();
  assert.deepEqual(f.state.calls.find(call => call.action === 'subscribe'),{action:'subscribe',email:'subscriber@example.test',source:'shop_popup',website:''});
  await f.page.evaluate(() => document.getElementById('product-dialog').showModal());
  await f.page.locator('#newsletter-dialog').waitFor({state:'detached'});
  assert.equal(await f.page.locator('#product-dialog').isVisible(),true,'Opening a product closes the invitation');
  await f.context.close();

  f = await fixture({storageBlocked:true}); await f.page.goto(origin+'/shop.html'); await advance(f.page);
  await f.page.waitForFunction(() => window.authReads >= 2); await new Promise(resolveWait => setTimeout(resolveWait,80));
  assert.equal(await f.page.locator('#newsletter-dialog').count(),0,'Guest popup is suppressed when its seen flag cannot persist');
  await f.page.reload(); await advance(f.page); await f.page.waitForFunction(() => window.authReads >= 2); await new Promise(resolveWait => setTimeout(resolveWait,80));
  assert.equal(await f.page.locator('#newsletter-dialog').count(),0,'Storage failure cannot repeat an invitation after reload'); await f.context.close();

  f = await fixture({storageBlocked:true,user:{id:'account-without-storage',email:'storage@example.test'}});
  await f.page.goto(origin+'/shop.html'); await advance(f.page); await f.page.locator('#newsletter-dialog').waitFor({state:'visible'});
  assert.equal(f.state.calls.filter(call => call.action === 'popup_claim').length,1,'Signed-in visitors still use the persistent server claim without local storage'); await f.context.close();

  f = await fixture();
  const otherTab = await f.context.newPage(); await otherTab.clock.install();
  await Promise.all([f.page.goto(origin+'/shop.html'),otherTab.goto(origin+'/shop.html')]);
  await Promise.all([advance(f.page),advance(otherTab)]);
  await new Promise(resolveWait => setTimeout(resolveWait,100));
  assert.equal(await f.page.locator('#newsletter-dialog[open]').count() + await otherTab.locator('#newsletter-dialog[open]').count(),1,'Concurrent guest tabs share one permanent invitation');
  await f.context.close();

  f = await fixture(); await f.page.goto(origin+'/index.html');
  await f.page.locator('#newsletter-home-email').fill('homepage@example.test');
  await f.page.locator('[data-newsletter-form] button[type=submit]').click();
  await f.page.getByText('Subscribed',{exact:true}).waitFor();
  assert.deepEqual(f.state.calls,[{action:'subscribe',email:'homepage@example.test',source:'homepage',website:''}]); await f.context.close();

  const member = {id:'once-ever-account',email:'member@example.test',email_confirmed_at:'2026-01-01'};
  for (let device = 0; device < 2; device++) {
    f = await fixture({user:member}); await f.page.goto(origin + '/shop.html'); await advance(f.page);
    if (!device) await f.page.locator('#newsletter-dialog').waitFor({state:'visible'});
    else { await f.page.waitForFunction(() => window.authReads >= 2); await new Promise(resolveWait => setTimeout(resolveWait,80)); assert.equal(await f.page.locator('#newsletter-dialog').count(),0,'Server claim prevents another device showing it'); }
    await f.context.close();
  }
  f = await fixture({user:member,initial:'subscribed'}); await f.page.goto(origin+'/shop.html'); await advance(f.page);
  assert.equal(await f.page.locator('#newsletter-dialog').count(),0,'Subscribers never see the invitation'); await f.context.close();
  for (const path of ['/shop.html?demo=1','/shop.html#order=test']) {
    f = await fixture(); await f.page.goto(origin+path); await f.page.clock.fastForward(6000);
    assert.equal(await f.page.locator('#newsletter-dialog').count(),0); assert.equal(f.state.calls.length,0); await f.context.close();
  }

  f = await fixture(); await f.page.goto(origin+'/newsletter.html#confirm=private-token');
  await f.page.getByRole('button',{name:'Confirm subscription',exact:true}).waitFor();
  assert.equal(new URL(f.page.url()).hash,'','Private token scrubbed'); assert.equal(f.state.calls.length,0,'Opening an email link cannot confirm');
  await f.page.getByRole('button',{name:'Confirm subscription',exact:true}).click();
  await f.page.getByRole('heading',{name:'You’re on the list!'}).waitFor();
  assert.deepEqual(f.state.calls,[{action:'confirm',token:'private-token'}]);
  await f.page.goto(origin+'/newsletter.html#unsubscribe=private-unsubscribe');
  await f.page.getByRole('button',{name:'Unsubscribe',exact:true}).click();
  await f.page.getByRole('heading',{name:'You’re unsubscribed'}).waitFor();
  assert.equal(f.state.status,'unsubscribed'); await f.context.close();

  f = await fixture({failSubscribe:true}); await f.page.goto(origin+'/account.html?mode=signup');
  const check = f.page.locator('[name=newsletter]'); await check.waitFor(); assert.equal(await check.isChecked(),false,'Account opt-in starts unchecked');
  await f.page.locator('[name=email]').fill('new@example.test'); await f.page.locator('[name=password]').fill('local-test-password'); await f.page.locator('[name=confirm_password]').fill('local-test-password'); await check.check();
  await f.page.getByRole('button',{name:'Create account',exact:true}).last().click();
  await f.page.getByRole('button',{name:'Retry newsletter signup'}).waitFor();
  assert.equal(await f.page.evaluate(() => window.signupCalls),1);
  f.state.failSubscribe = false; await f.page.getByRole('button',{name:'Retry newsletter signup'}).click();
  await f.page.getByText('You’re subscribed to the TLB newsletter! Look out for your welcome email.').waitFor();
  assert.equal(await f.page.evaluate(() => window.signupCalls),1,'Newsletter retry never recreates account'); await f.context.close();

  f = await fixture({user:member,initial:'subscribed'}); await f.page.goto(origin+'/account.html');
  await f.page.locator('#newsletter-preferences [name=newsletter]').uncheck(); await f.page.getByRole('button',{name:'Save email preference'}).click();
  await f.page.getByText('You’re unsubscribed from the TLB newsletter. Your order and payment emails are unchanged.').waitFor();
  assert.equal(f.state.status,'unsubscribed');
  await f.page.locator('#newsletter-preferences [name=newsletter]').check(); await f.page.getByRole('button',{name:'Save email preference'}).click();
  await f.page.getByText('You’re subscribed! Look out for a welcome email from TLB.').waitFor(); assert.equal(f.state.status,'subscribed');
  assert.equal(await f.page.getByRole('button',{name:'Resend confirmation'}).count(),0); await f.page.reload();
  await f.page.getByText('You’re subscribed to the TLB newsletter.',{exact:true}).waitFor(); await f.context.close();
  f = await fixture({user:member,initial:'pending'}); await f.page.goto(origin+'/account.html');
  await f.page.locator('#newsletter-preferences [name=newsletter]').check(); await f.page.getByRole('button',{name:'Save email preference'}).click();
  await f.page.getByText('You’re subscribed! Look out for a welcome email from TLB.').waitFor(); assert.equal(f.state.status,'subscribed'); await f.context.close();
  assert.deepEqual(errors,[]); assert.deepEqual(forbidden,[]);
  console.log('PASS: once-only popup on mobile and across devices; modal exclusion; demo/order suppression; immediate subscription, legacy links and private-token scrubbing; optional signup and independent retry; subscribe/unsubscribe preferences. No live emails.');
} finally { await browser?.close(); await new Promise(resolveClose => server.close(resolveClose)); }

