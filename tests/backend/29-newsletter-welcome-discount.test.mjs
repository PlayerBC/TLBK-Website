import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export default async function({db,check,state}) {
  const h=state.harness,{as,api,ids,scalar}=h;
  const migration=(await readFile(new URL('../../supabase/migrations/20260923140252_newsletter_welcome_discount.sql',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('../../supabase/migrations/20260923141944_short_newsletter_welcome_codes.sql',import.meta.url),'utf8'));
  // Earlier suites deliberately replay older definitions. Restore the latest.
  await db.exec(migration);
  await db.exec("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 hours' where event='requested'");
  const token=()=>randomBytes(32).toString('hex'),hash=t=>createHash('sha256').update(t).digest('hex');
  const call=(action,payload={})=>as(null,async()=> (await db.query('select public.newsletter_service($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');
  const row=email=>db.query('select * from tlb.newsletter_subscribers where email=$1',[email]).then(r=>r.rows[0]);
  const start=email=>call('begin_subscribe',{email,source:'homepage',token_hash:hash(token()),ip_hash:hash(token())});
  const finish=async op=>{const unsubscribe_token=token();await call('finish_confirm',{...op,contact_id:randomUUID(),unsubscribe_token,unsubscribe_token_hash:hash(unsubscribe_token)});return unsubscribe_token};
  const signup=async()=>{
    const user=randomUUID(),email=`welcome-${user}@example.test`;
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,email]);
    const op=await start(email),unsubscribe=await finish(op),saved=await row(email);
    const promo=await scalar('select data from tlb.promos where id=$1',[saved.welcome_promo_id]);
    return {user,email,op,unsubscribe,saved,promo};
  };
  const report=()=>api('admin_bootstrap',{},ids.owner);
  let subscriber;
  await check('only new addresses receive one email-bound welcome code with fixed terms and an exact 30-day lifetime',async()=>{
    subscriber=await signup();const {email,op,promo,saved}=subscriber;
    assert.match(promo.code,/^[A-HJ-NP-Z2-9]{6}$/);assert.match(promo.code,/[A-Z]/);assert.match(promo.code,/[2-9]/);
    assert.equal(promo.value,5);assert.equal(promo.min_subtotal_cents,30000);assert.equal(promo.cap_cents,10000);
    assert.equal(promo.global_limit,1);assert.equal(promo.per_account_limit,1);
    assert.equal(Date.parse(promo.expires_at)-Date.parse(promo.issued_at),30*86400000);
    assert.equal((await start(email.toUpperCase())).already_subscribed,true);
    assert.equal((await row(email)).welcome_promo_id,saved.welcome_promo_id);
    const messages=(await db.query('select payload from tlb.outbox where event_key=$1',['newsletter-welcome:'+op.request_id])).rows;
    assert.equal(messages.length,1);assert.deepEqual(messages[0].payload.welcome_offer,promo);
    const old=`old-${randomUUID()}@example.test`;
    await db.query("insert into tlb.newsletter_subscribers(email,welcome_offer_eligible,status) values($1,false,'unsubscribed')",[old]);
    await finish(await start(old));assert.equal((await row(old)).welcome_promo_id,null);
    assert.equal(await scalar("select payload ? 'welcome_offer' from tlb.outbox where to_email=$1",[old]),false);
  })();
  await check('migration marks pre-existing addresses ineligible and replay never resets issued codes or new-address eligibility',async()=>{
    await db.exec('begin');
    try {
      await db.exec('alter table tlb.newsletter_subscribers drop column welcome_offer_eligible,drop column welcome_promo_id,drop column welcome_issued_at');
      await db.exec(migration);
      assert.equal(await scalar('select count(*)::int from tlb.newsletter_subscribers where welcome_offer_eligible'),0);
      const fresh=`after-${randomUUID()}@example.test`;
      await db.query('insert into tlb.newsletter_subscribers(email) values($1)',[fresh]);
      await db.exec(migration);
      assert.equal((await row(fresh)).welcome_offer_eligible,true);
    } finally {await db.exec('rollback')}
    const before=await row(subscriber.email);await db.exec(migration);await db.exec(migration.replace(/\r?\n/g,'\r\n'));
    assert.deepEqual(await row(subscriber.email),before);
  })();
  let product,date,order;
  await check('welcome redemption verifies account email, product minimum, delivery exclusion, cap and expiry',async()=>{
    await api('save_settings',{settings:{...(await report()).settings,paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],blocked_dates:[]}},ids.owner);
    ({product,date}=await h.fixture(100,{price_cents:30000}));
    const payload=h.checkout(product,date,{promo_code:subscriber.promo.code});
    await db.query('update auth.users set email_confirmed_at=null where id=$1',[ids.unverified]);
    await assert.rejects(api('quote',payload),/verified email/);
    await assert.rejects(api('quote',payload,ids.unverified),/verified email/);
    await assert.rejects(api('quote',{...payload,buyer:{...payload.buyer,email:subscriber.email}},ids.stranger),/different email/);
    const atMinimum=await api('quote',payload,subscriber.user);assert.equal(atMinimum.discount_cents,1500);
    const capped=await api('quote',{...payload,items:[h.item(product,10)]},subscriber.user);assert.equal(capped.discount_cents,10000);
    const zone=await api('save_zone',{zone:{name:'Welcome QA',localities:['Welcome QA City'],fee_cents:15000,active:true}},ids.owner);
    const below=await h.product({price_cents:29900});await h.inventory(below,date,10);
    await assert.rejects(api('quote',{...payload,items:[h.item(below)],method:'delivery',address:{locality:zone.localities[0]}},subscriber.user),/subtotal.*300/);
    const delivered=await api('quote',{...payload,method:'delivery',address:{locality:zone.localities[0]}},subscriber.user);
    assert.equal(delivered.discount_cents,1500);assert.equal(delivered.delivery_cents,15000);assert.equal(delivered.total_cents,43500);
    const expiry=subscriber.promo.expires_at;
    await db.query("update tlb.promos set data=jsonb_set(data,'{expires_at}',to_jsonb(clock_timestamp()-interval '1 second')) where id=$1",[subscriber.promo.id]);
    await assert.rejects(api('quote',payload,subscriber.user),/expired/);
    await db.query("update tlb.promos set data=jsonb_set(data,'{expires_at}',$2::jsonb) where id=$1",[subscriber.promo.id,JSON.stringify(expiry)]);
  })();
  await check('single-use welcome codes reserve atomically and report separately from regular promos',async()=>{
    order=await api('create_order',h.checkout(product,date,{promo_code:subscriber.promo.code}),subscriber.user);
    await assert.rejects(api('create_order',h.checkout(product,date,{promo_code:subscriber.promo.code}),subscriber.user),/use limit/);
    const dashboard=await report();
    let entry=dashboard.newsletter_promos.find(p=>p.id===subscriber.promo.id);
    assert.equal(entry.email,subscriber.email);assert.equal(entry.reserved_count,1);assert.equal(entry.redeemed_count,0);assert.equal(entry.sales_cents,0);
    assert.deepEqual((await api('admin_bootstrap',{},ids.staff)).newsletter_promos,[]);
    await assert.rejects(api('admin_bootstrap',{},subscriber.user),/staff|authorized/i);
    order=await h.action('approve_payment',await h.proof(order));
    entry=(await report()).newsletter_promos.find(p=>p.id===subscriber.promo.id);
    assert.equal(entry.redeemed_count,1);assert.equal(entry.reserved_count,0);assert.equal(entry.sales_cents,28500);assert.equal(entry.discount_cents,1500);
    await assert.rejects(api('quote',h.checkout(product,date,{promo_code:subscriber.promo.code}),subscriber.user),/use limit/);
    order=await h.action('set_refund_label',order,{enabled:true});
    entry=(await report()).newsletter_promos.find(p=>p.id===subscriber.promo.id);
    assert.equal(entry.redeemed_count,1);assert.equal(entry.sales_cents,0);assert.equal(entry.discount_cents,0);
    order=await h.action('set_refund_label',order,{enabled:false});
    await h.action('cancel_order',order,{reason:'QA cancellation',restore_stock:true});
    entry=(await report()).newsletter_promos.find(p=>p.id===subscriber.promo.id);
    assert.equal(entry.redeemed_count,1);assert.equal(entry.sales_cents,0);
  })();
  await check('unsubscribe/rejoin keeps the original code and expiry without issuing another discount',async()=>{
    const before=await row(subscriber.email);
    await call('finish_unsubscribe',await call('begin_unsubscribe',{token_hash:hash(subscriber.unsubscribe)}));
    await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1",[subscriber.email]);
    const next=await start(subscriber.email);await finish(next);
    assert.equal((await row(subscriber.email)).welcome_promo_id,before.welcome_promo_id);
    assert.equal(await scalar("select payload ? 'welcome_offer' from tlb.outbox where event_key=$1",['newsletter-welcome:'+next.request_id]),false);
    assert.equal((await scalar('select data from tlb.promos where id=$1',[before.welcome_promo_id])).expires_at,subscriber.promo.expires_at);
    for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'tlb.newsletter_promo_report()','execute')",[role]),false);
  })();
}
