import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export default async function ({db,check,state}) {
  const h=state.harness;
  const {api,ids,fixture,checkout,proof,service,action,scalar}=h;
  const rows=id=>db.query("select * from tlb.outbox where order_id=$1 and event_type='order_review_required' order by to_email",[id]).then(r=>r.rows);
  const create=async()=>{const {product,date}=await fixture();return api('create_order',checkout(product,date))};
  const retire=()=>db.exec("update tlb.outbox set status='skipped',lease_token=null,leased_until=null where status in ('pending','sending')");
  const fresh=async()=>{
    await retire();const submitted=await create(),reviewed=await proof(submitted);
    await db.query("update tlb.outbox set status='skipped' where order_id=$1 and event_type<>'order_review_required'",[submitted.id]);
    return {submitted,reviewed,claimed:await service('claim_emails',{limit:10})};
  };
  const oldSettings=(await api('admin_bootstrap',{},ids.owner)).settings;
  await api('save_settings',{settings:{reminders_enabled:false}},ids.owner);
  try {
    await check('each accepted proof queues one private review notification per owner and staff email',async()=>{
      const submitted=await create();
      assert.equal((await rows(submitted.id)).length,0,'Unpaid orders alone do not need proof review');
      await service('authorize_upload',{kind:'proof',order_id:submitted.id,token:submitted.access_token});
      assert.equal((await rows(submitted.id)).length,0,'Starting an upload does not send an alert');
      await assert.rejects(proof(submitted,{path:'invalid-proof-path'}),/Invalid private proof/);
      assert.equal((await rows(submitted.id)).length,0);
      const reviewed=await proof(submitted);
      const queued=await rows(submitted.id);
      assert.equal(reviewed.payment_status,'under_review');
      assert.deepEqual(queued.map(r=>r.to_email),['owner@example.test','staff@example.test']);
      for(const row of queued){
        assert.equal(row.status,'pending');
        assert.match(row.subject,new RegExp(submitted.reference));
        assert.match(row.event_key,new RegExp(`^review:${submitted.id}:${reviewed.revision}:`));
        assert.equal(row.payload.order.reference,submitted.reference);
        assert.equal(row.payload.order.total_cents,submitted.total_cents);
        assert.deepEqual(Object.keys(row.payload.settings).sort(),['shop_name','site_url']);
        assert.doesNotMatch(JSON.stringify(row.payload),/access_token|access_encrypted|proof_path|payment_instructions|history|guest-token/);
        assert.ok(Array.isArray(row.payload.recipient_user_ids));
      }
      await assert.rejects(proof(submitted),/no longer accepted/);
      await db.query('select tlb.queue_order_review_emails($1)',[submitted.id]);
      await action('add_staff_note',reviewed,{note:'Local notification test'});
      assert.equal((await rows(submitted.id)).length,2,'Retries and notes cannot duplicate the same review event');
    })();

    await check('future team members are included, unverified accounts excluded, and duplicate email addresses deduplicated',async()=>{
      const extraId=randomUUID(),unverifiedId=randomUUID();
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[extraId,'STAFF@example.test']);
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,null)',[unverifiedId,'unverified-review@example.test']);
      await db.query("insert into tlb.staff(user_id,role) values($1,'staff'),($2,'staff')",[extraId,unverifiedId]);
      await api('save_staff',{email:'stranger@example.test',role:'owner'},ids.owner);
      try{
        const submitted=await create();await proof(submitted);
        const queued=await rows(submitted.id);
        assert.deepEqual(queued.map(r=>r.to_email),['owner@example.test','staff@example.test','stranger@example.test']);
        assert.equal(queued.find(r=>r.to_email==='staff@example.test').payload.recipient_user_ids.length,2);
      }finally{
        await api('save_staff',{email:'stranger@example.test',role:'none'},ids.owner);
        await db.query('delete from tlb.staff where user_id in ($1,$2)',[extraId,unverifiedId]);
        await db.query('delete from auth.users where id in ($1,$2)',[extraId,unverifiedId]);
      }
    })();

    await check('worker rechecks role removal and email changes before disclosing a queued review',async()=>{
      const first=await fresh();
      assert.equal(first.claimed.length,2);
      const staff=first.claimed.find(r=>r.to_email==='staff@example.test');
      const owner=first.claimed.find(r=>r.to_email==='owner@example.test');
      await api('save_staff',{email:'staff@example.test',role:'none'},ids.owner);
      try{
        assert.equal((await service('prepare_email',staff)).skip,true);
        assert.equal(await scalar('select status from tlb.outbox where id=$1',[staff.id]),'skipped');
        assert.equal((await service('prepare_email',owner)).to_email,'owner@example.test');
      }finally{await api('save_staff',{email:'staff@example.test',role:'staff'},ids.owner)}
      const second=await fresh();
      const changed=second.claimed.find(r=>r.to_email==='staff@example.test');
      await db.query('update auth.users set email=$1 where id=$2',['new-staff@example.test',ids.staff]);
      try{assert.equal((await service('prepare_email',changed)).skip,true)}
      finally{await db.query('update auth.users set email=$1 where id=$2',['staff@example.test',ids.staff])}
    })();

    await check('already approved, rejected or cancelled orders do not send stale review requests',async()=>{
      for(const outcome of ['approve_payment','reject_payment','cancel_order']){
        const {reviewed,claimed}=await fresh();
        await action(outcome,reviewed,{reason:'Local test resolution',restore_stock:true});
        for(const row of claimed)assert.equal((await service('prepare_email',row)).skip,true,outcome);
      }
    })();

    await check('review email retries keep the recipient, payload and event key and sent emails cannot be reclaimed',async()=>{
      const {claimed}=await fresh();
      const row=claimed[0];
      const initial=await service('prepare_email',row);
      await service('email_failed',{...row,error:'Simulated temporary provider failure'});
      await db.query("update tlb.outbox set available_at=now()-interval '1 minute' where id=$1",[row.id]);
      const retry=(await service('claim_emails',{limit:10})).find(r=>r.id===row.id);
      assert.ok(retry);assert.notEqual(retry.lease_token,row.lease_token);
      const prepared=await service('prepare_email',retry);
      assert.equal(prepared.event_key,initial.event_key);
      assert.equal(prepared.to_email,initial.to_email);
      assert.deepEqual(prepared.payload,initial.payload);
      await service('email_sent',{...retry,provider_id:'QA-review-accepted'});
      assert.equal((await service('claim_emails',{limit:10})).some(r=>r.id===row.id),false);
    })();

    await check('queueing is private and cannot be invoked by public or signed-in customer roles',async()=>{
      for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'tlb.queue_order_review_emails(uuid)','execute')",[role]),false);
      assert.equal(await scalar("select not prosecdef and proconfig @> array['search_path=\"\"'] from pg_proc where oid='tlb.queue_order_review_emails(uuid)'::regprocedure"),true);
      const submitted=await create();
      for(const user of [null,ids.customer,ids.staff])await assert.rejects(h.as(user,()=>db.query('select tlb.queue_order_review_emails($1)',[submitted.id])),/permission denied/);
      await assert.rejects(db.query('select tlb.queue_order_review_emails($1)',[submitted.id]),/Only a submitted payment proof/);
      assert.equal((await rows(submitted.id)).length,0);
    })();

    await check('staff email migration replay keeps queued messages, service grants and proof processing intact',async()=>{
      const migration=await readFile(new URL('../../supabase/migrations/20260918195030_staff_order_review_emails.sql',import.meta.url),'utf8');
      const definition=await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)");
      const count=await scalar('select count(*) from tlb.outbox');
      const installedQueue=await scalar("select pg_get_functiondef('tlb.queue_order_review_emails(uuid)'::regprocedure)");
      await db.exec(migration.replace(/\r\n/g,'\n'));
      await db.exec(migration.replace(/\r?\n/g,'\r\n'));
      assert.equal(await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)"),definition);
      assert.equal(await scalar('select count(*) from tlb.outbox'),count);
      for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'public.shop_service(text,jsonb)','execute')",[role]),false);
      assert.equal(await scalar("select has_function_privilege('service_role','public.shop_service(text,jsonb)','execute')"),true);
      // Later migrations may extend the queue payload; keep subsequent suites
      // on the complete installed schema after checking this older migration.
      await db.exec(installedQueue);
    })();
  }finally{await api('save_settings',{settings:oldSettings},ids.owner)}
}
