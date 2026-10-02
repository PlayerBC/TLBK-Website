import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAcademyEmail as workerRender} from '../supabase/functions/_shared/academy-email.ts';
import {academyEmailPreview} from '../assets/ordering/academy-email-composer.js';
test('Preview and sending worker use identical Academy email output',()=>{
 for(const kind of ['marketing','operational']){
  const payload={kind,subject:'Baking camp <2026>',body:'First line\nSecond line & another tip.'},address='Fixture business address';
  assert.deepEqual(academyEmailPreview(payload,address),workerRender({title:payload.subject,preview:payload.body,url:'https://thelittlebakerkitchen.com/academy/dashboard',marketing:kind==='marketing',unsubscribe_token:'0'.repeat(64),address}));
 }
});
test('Preview escapes HTML, includes accessible structure and keeps marketing unsubscribe distinct',()=>{
 const marketing=academyEmailPreview({kind:'marketing',subject:'<img src=x>',body:'<script>alert(1)</script>'},'Fixture address');
 assert.ok(!marketing.html.includes('<script>'));assert.ok(marketing.html.includes('&lt;script&gt;'));assert.match(marketing.html,/<html lang="en" dir="ltr">/);assert.match(marketing.html,/<table lang="en" dir="ltr" role="presentation"/);assert.match(marketing.text,/Unsubscribe from Academy marketing/);
 const operational=academyEmailPreview({kind:'operational',subject:'Class update',body:'Materials are available.'});assert.ok(!operational.html.includes('Unsubscribe from Academy marketing'));assert.equal(operational.headers,undefined);
});
