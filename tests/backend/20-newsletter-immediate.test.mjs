import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const { as, scalar, service }=state.harness;
  const token=()=>randomBytes(32).toString('hex');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const call=(action,payload={})=>as(null,async()=> (await db.query('select public.newsletter_service($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');
  const input=(email=`single-${randomUUID()}@example.test`)=>({email,source:'homepage',token_hash:hash(token()),ip_hash:hash(token())});
  const row=async email=>(await db.query('select * from tlb.newsletter_subscribers where email=$1',[email])).rows[0];
  const finish=async operation=>{
    const unsubscribe_token=token();
    await call('finish_confirm',{...operation,contact_id:randomUUID(),unsubscribe_token,unsubscribe_token_hash:hash(unsubscribe_token)});
    return {...operation,unsubscribe_token};
  };
  const queue=async email=>(await db.query('select * from tlb.outbox where to_email=$1 order by created_at',[email])).rows;
  const lease=async email=>{
    const lease_token=randomUUID();
    return (await db.query("update tlb.outbox set status='sending',lease_token=$2,leased_until=now()+interval '3 minutes',attempts=attempts+1 where to_email=$1 and status='pending' returning id,lease_token",[email,lease_token])).rows[0];
  };
  await db.exec("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 hours' where event='requested'");

  await check('immediate signup records consent and commits subscription with exactly one welcome',async()=>{
    const values=input();const begun=await call('begin_subscribe',values);
    assert.ok(begun.operation_id);assert.equal(begun.email,values.email);
    assert.equal((await row(values.email)).status,'pending');
    const completed=await finish(begun);const saved=await row(values.email);
    assert.equal(saved.status,'subscribed');assert.equal(saved.consent_version,'tlb-newsletter-v2-single-opt-in');
    const messages=await queue(values.email);assert.equal(messages.length,1);
    assert.equal(messages[0].order_id,null);assert.equal(messages[0].event_key,`newsletter-welcome:${begun.request_id}`);
    assert.equal(messages[0].payload.unsubscribe_token,completed.unsubscribe_token);
    assert.equal(messages[0].payload.unsubscribe_token_hash,saved.unsubscribe_token_hash);
    assert.equal((await call('begin_subscribe',input(values.email))).already_subscribed,true);
    assert.equal((await queue(values.email)).length,1);
    await assert.rejects(finish(begun),/expired|replaced/i);
    assert.equal((await queue(values.email)).length,1);
  })();

  await check('invalid unsubscribe token rolls back both activation and welcome queue',async()=>{
    const operation=await call('begin_subscribe',input());
    await assert.rejects(call('finish_confirm',{...operation,contact_id:randomUUID(),unsubscribe_token:token(),unsubscribe_token_hash:hash(token())}),/Invalid welcome/i);
    assert.equal((await row(operation.email)).status,'pending');assert.equal((await queue(operation.email)).length,0);
    await finish(operation);assert.equal((await queue(operation.email)).length,1);
  })();

  await check('old pending signup activates on resubmission while rate and active-operation limits remain enforced',async()=>{
    const values=input();await call('request',values);
    assert.equal((await call('begin_subscribe',input(values.email))).rate_limited,true);
    await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1",[values.email]);
    const started=await call('begin_subscribe',input(values.email));
    assert.equal((await call('begin_subscribe',input(values.email))).busy,true);
    await finish(started);assert.equal((await row(values.email)).status,'subscribed');
    assert.equal((await queue(values.email)).length,1);
    await assert.rejects(call('begin_subscribe',{...input(),email:'not-email'}),/email/i);
  })();

  await check('pending provider jobs resume unchanged rather than starting a second signup',async()=>{
    const operation=await call('begin_subscribe',input());
    const pending=await call('mark_import_start',{...operation,contact_id:randomUUID()});
    await db.query("update tlb.newsletter_subscribers set operation_expires_at=clock_timestamp()-interval '1 second' where email=$1",[operation.email]);
    const resumed=await call('begin_subscribe',input(operation.email));
    assert.equal(resumed.resume_import,true);assert.equal(resumed.operation_id,operation.operation_id);
    assert.equal(resumed.provider_import_filename,pending.provider_import_filename);
    assert.equal((await queue(operation.email)).length,0);
  })();

  await check('unsubscribe before delivery skips the welcome and resubscription invalidates the older welcome',async()=>{
    const complete=await finish(await call('begin_subscribe',input()));
    const unsubscribe=await call('begin_unsubscribe',{token_hash:hash(complete.unsubscribe_token)});
    await call('finish_unsubscribe',unsubscribe);
    const claimed=await lease(complete.email);
    assert.equal((await service('prepare_email',claimed)).skip,true);
    await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1",[complete.email]);
    await finish(await call('begin_subscribe',input(complete.email)));
    const messages=await queue(complete.email);assert.equal(messages.length,2);assert.equal(messages[0].status,'skipped');
    const fresh=await lease(complete.email);const prepared=await service('prepare_email',fresh);
    assert.equal(prepared.payload.event_type,'newsletter_welcome');
    assert.notEqual(prepared.payload.unsubscribe_token,complete.unsubscribe_token);
    await service('email_skipped',{...fresh,reason:'Provider opt-out'});
    assert.equal(await scalar('select status from tlb.outbox where id=$1',[fresh.id]),'skipped');
  })();

  await check('welcome retry retains its exact event key and payload, with stale acknowledgements rejected',async()=>{
    const complete=await finish(await call('begin_subscribe',input()));const first=await lease(complete.email);
    const original=await service('prepare_email',first);
    await service('email_failed',{...first,error:'Controlled retry'});
    const second=await lease(complete.email);const retry=await service('prepare_email',second);
    assert.equal(retry.event_key,original.event_key);assert.deepEqual(retry.payload,original.payload);
    await assert.rejects(service('email_sent',{...first,provider_id:'stale'}),/stale/i);
    await service('email_sent',{...second,provider_id:'accepted'});
    assert.equal(await scalar('select status from tlb.outbox where id=$1',[second.id]),'sent');
  })();

  await check('immediate newsletter migration is repeatable with preserved grants and unrelated order data',async()=>{
    const migration=await readFile(new URL('../../supabase/migrations/20260919081558_newsletter_immediate_subscription.sql',import.meta.url),'utf8');
    const snapshot=async()=> (await db.query("select (select jsonb_agg(to_jsonb(o) order by id) from tlb.orders o) as orders,(select jsonb_agg(to_jsonb(n) order by email) from tlb.newsletter_subscribers n) as subscribers,(select jsonb_agg(to_jsonb(e) order by id) from tlb.outbox e) as outbox")).rows[0];
    const before=await snapshot();await db.exec(migration);await db.exec(migration.replace(/\r?\n/g,'\r\n'));assert.deepEqual(await snapshot(),before);
    for(const role of ['anon','authenticated']){
      for(const signature of ['public.newsletter_service(text,jsonb)','tlb.begin_newsletter_subscription(jsonb)','tlb.queue_newsletter_welcome(text,text)']){
        assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
      }
    }
    assert.equal(await scalar("select has_function_privilege('service_role','public.newsletter_service(text,jsonb)','execute')"),true);
    await assert.rejects(db.exec("insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values('invalid-order-reference','order_submitted','test@example.test','test','{}')"),/outbox_order_reference/i);
  })();
}
