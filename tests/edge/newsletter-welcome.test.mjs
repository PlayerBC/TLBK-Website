import test from 'node:test';
import assert from 'node:assert/strict';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-service',EMAIL_WORKER_TOKEN:'private-worker-token-with-32-characters',RESEND_API_KEY:'private-order-key',EMAIL_FROM:'Orders <orders@example.test>',NEWSLETTER_RESEND_API_KEY:'private-newsletter-key',NEWSLETTER_FROM:'TLB <hello@example.test>'};
let worker;
globalThis.Deno={env:{get:name=>env[name]},serve:value=>{worker=value;}};
await import('../../supabase/functions/email-worker/index.ts');
const {renderEmail}=await import('../../supabase/functions/_shared/emails.ts');
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status});
const payload={event_type:'newsletter_welcome',topic_id:'newsletter',unsubscribe_token:'a'.repeat(64),settings:{site_url:'https://thelittlebakerkitchen.com',shop_name:'TLB <Kitchen>',pickup_address:'Test & address',contact_email:'hello@example.test'}};
const run=()=>worker(new Request('https://worker.test',{method:'POST',headers:{'x-worker-token':env.EMAIL_WORKER_TOKEN}}));

test('welcome email has both formats, menu and unsubscribe links, and requires no order or confirmation',()=>{
  const rendered=renderEmail(payload);
  assert.match(rendered.html,/TLB &lt;Kitchen&gt;/);assert.match(rendered.html,/Test &amp; address/);
  for(const content of [rendered.html,rendered.text]){
    assert.match(content,/Welcome to our kitchen/);assert.match(content,/You’re on the list/);
    assert.match(content,/https:\/\/thelittlebakerkitchen\.com\/shop\.html/);
    assert.match(content,/#unsubscribe=a{64}/);assert.doesNotMatch(content,/confirm=|Confirm your|order reference/i);
  }
  for(const site_url of ['http://unsafe.test','https://user:password@unsafe.test','bad-url']){
    assert.throws(()=>renderEmail({...payload,settings:{...payload.settings,site_url}}),/HTTPS|valid site/);
  }
  assert.throws(()=>renderEmail({...payload,unsubscribe_token:'invalid'}),/unsubscribe link/);
});

test('welcome worker preserves suppression, sender configuration and stable retry body',async()=>{
  let acceptedBody=null;
  for(const scenario of ['global','topic','missing','outage','send_failure','send','retry_ack']){
    const actions=[],sends=[];
    const row={id:'welcome-row',event_key:'newsletter-welcome:request-1',to_email:'new@example.test',subject:'Welcome to the TLB newsletter!',lease_token:'lease',payload};
    globalThis.fetch=async(url,options={})=>{
      if(String(url).includes('/rpc/shop_service')){
        const body=JSON.parse(options.body);actions.push(body.p_action);
        if(body.p_action==='claim_emails')return reply([row]);
        if(body.p_action==='prepare_email')return reply(row);
        if(body.p_action==='email_sent'&&scenario==='retry_ack')return reply({error:'ack failed'},503);
        return reply({});
      }
      assert.equal(new Headers(options.headers).get('Authorization'),'Bearer private-newsletter-key');
      if(String(url).endsWith('/emails')){
        const body=JSON.parse(options.body);sends.push(body);
        assert.equal(body.from,env.NEWSLETTER_FROM);assert.deepEqual(body.to,[row.to_email]);
        assert.equal(new Headers(options.headers).get('Idempotency-Key'),row.event_key);
        if(acceptedBody)assert.deepEqual(body,acceptedBody);acceptedBody=body;
        return scenario==='send_failure'?reply({name:'rate_limited'},429):reply({id:'provider-accepted'});
      }
      if(scenario==='outage')return reply({error:'unavailable'},503);
      if(String(url).includes('/topics?'))return reply({data:[{id:'newsletter',subscription:scenario==='topic'?'opt_out':'opt_in'}],has_more:false});
      return scenario==='missing'?reply({},404):reply({id:'contact',unsubscribed:scenario==='global'});
    };
    const response=await run();assert.equal(response.status,200);const stats=await response.json();
    if(['global','topic','missing'].includes(scenario)){
      assert.equal(sends.length,0);assert.equal(stats.skipped,1);assert.ok(actions.includes('email_skipped'));assert.ok(!actions.includes('email_sent'));
    }else if(['outage','send_failure','retry_ack'].includes(scenario)){
      assert.equal(stats.failed,1);assert.ok(actions.includes('email_failed'));
      assert.equal(stats.acknowledgement_pending,scenario==='retry_ack'?1:0);
    }else{assert.equal(stats.accepted,1);assert.equal(sends.length,1);assert.ok(actions.includes('email_sent'));}
  }
});

test('new subscriber email includes the personal offer, full limits and exact Manila expiry in HTML and text',()=>{
  const welcome_offer={code:'7K4M9Q',value:5,min_subtotal_cents:30000,cap_cents:10000,expires_at:'2026-10-23T06:00:00Z'};
  const rendered=renderEmail({...payload,welcome_offer});
  for(const content of [rendered.html,rendered.text]){
    assert.match(content,/7K4M9Q/);assert.match(content,/5%/);
    assert.match(content,/₱300/);assert.match(content,/₱100/);assert.match(content,/30 days/);
    assert.match(content,/Delivery fees are excluded from both/);assert.match(content,/one use only/);
    assert.match(content,/Sign in with the email address receiving this message/);
    assert.match(content,/23 October 2026|October 23, 2026/);assert.match(content,/2:00\s*pm|2:00\s*PM/);
    assert.match(content,/PHT/);assert.match(content,/newsletter subscribers/);assert.match(content,/#unsubscribe=/);
  }
  assert.deepEqual(renderEmail({...payload,welcome_offer}),rendered,'Retry content must be stable');
  assert.match(renderEmail({...payload,welcome_offer:{...welcome_offer,code:'WELCOME-1234567890ABCDEF'}}).text,/WELCOME-1234567890ABCDEF/,'Previously issued codes stay supported');
  assert.doesNotMatch(renderEmail(payload).text,/Your welcome gift/,'Existing subscribers get no promise of another code');
  assert.throws(()=>renderEmail({...payload,welcome_offer:{...welcome_offer,code:'<script>'}}),/discount is invalid/);
});
