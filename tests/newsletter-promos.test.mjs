import test from 'node:test';
import assert from 'node:assert/strict';
import {newsletterPromoStats,newsletterPromoStatus,renderNewsletterPromos} from '../assets/ordering/newsletter-promos.js';
const now=Date.parse('2026-09-23T12:00:00Z');
const base={active:true,expires_at:'2026-10-23T12:00:00Z',sales_cents:0,discount_cents:0};
test('welcome analytics separate active, expired, reserved, used and disabled codes without double counting',()=>{
  const promos=[base,{...base,expires_at:'2026-09-23T12:00:00Z'},{...base,reserved_count:1},{...base,redeemed_count:1,sales_cents:28500,discount_cents:1500,expires_at:'2026-08-23T12:00:00Z'},{...base,deleted_at:'2026-09-01',active:false}];
  assert.deepEqual(newsletterPromoStats(promos,now),{issued:5,used:1,reserved:1,active:1,expired:1,inactive:1,sales_cents:28500,discount_cents:1500});
  assert.equal(newsletterPromoStatus({...base,reserved_count:1,expires_at:'2026-08-23'},now),'reserved','A valid pending-payment reservation is not counted as unused expiry');
  assert.equal(newsletterPromoStatus({...base,active:false,redeemed_count:1},now),'used','Disabling a code retains its paid usage');
});
test('welcome analytics render safe subscriber text and explain net product sales',()=>{
  const esc=x=>String(x).replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html=renderNewsletterPromos([{...base,email:'<img>@example.test',code:'WELCOME-ABC'}],{money:x=>'PHP '+x/100,escapeHtml:esc,dateTime:x=>x||'',now});
  assert.match(html,/&lt;img&gt;/);assert.doesNotMatch(html,/<img>/);assert.match(html,/excluding delivery, cancelled orders and refunds/);
});
