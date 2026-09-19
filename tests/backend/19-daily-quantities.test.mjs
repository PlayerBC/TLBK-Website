import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export default async function({db,check,state}) {
 const h=state.harness, {api,ids,item,checkout,inventory,remaining}=h;
 const original=(await api('admin_bootstrap',{},ids.owner)).settings;
 await api('save_settings',{settings:{...original,paused:false,cutoff_time:null,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],nonproduction_dates:[]}},ids.owner);
 const product=await h.product({lead_days:0,allow_same_day:true}), date=await h.day(5), second=await h.day(7);
 const stock=async()=> (await api('admin_bootstrap',{},ids.staff)).inventory.find(row=>row.product_id===product.id&&row.date===date);
 await check('unlimited dates accept orders without inventory rows and still count allocations',async()=>{
  assert.equal(await remaining(product,date),null);
  await api('quote',checkout(product,date,{items:[item(product,20)]}));
  await api('create_order',checkout(product,date,{items:[item(product,20)]}));
  const row=await stock();
  assert.equal(row.capacity,null);assert.equal(row.remaining,null);assert.equal(row.reserved,20);assert.equal(row.unlimited,true);
 })();
 await check('a finite total includes earlier unlimited orders, clearing it keeps their allocations',async()=>{
  await assert.rejects(inventory(product,date,19),/already ordered/);
  await inventory(product,date,22);assert.equal(await remaining(product,date),2);
  await assert.rejects(api('quote',checkout(product,date,{items:[item(product,3)]})),/Only 2/);
  const before=(await db.query('select * from tlb.allocations where product_id=$1',[product.id])).rows;
  await inventory(product,date,null);
  assert.equal(await remaining(product,date),null);assert.equal((await stock()).reserved,20);
  assert.deepEqual((await db.query('select * from tlb.allocations where product_id=$1',[product.id])).rows,before);
  await api('quote',checkout(product,date,{items:[item(product,100)]}));
 })();
 await check('zero caps and explicit availability closures block orders, including unlimited dates',async()=>{
  await inventory(product,second,0);
  await assert.rejects(api('quote',checkout(product,second)),/Only 0/);
  await inventory(product,second,null,false);
  await assert.rejects(api('quote',checkout(product,second)),/unavailable/);
  await inventory(product,second,null,true);
  await api('quote',checkout(product,second));
 })();
 await check('staff can apply one total on several dates; a bad row rolls the entire batch back',async()=>{
  const row=(day,capacity)=>({product_id:product.id,date:day,capacity,available:true});
  await api('save_inventory',{rows:[row(date,25),row(second,25)]},ids.staff);
  assert.equal(await remaining(product,date),5);assert.equal(await remaining(product,second),25);
  await assert.rejects(api('save_inventory',{rows:[row(second,100),row(date,1)]},ids.staff),/already ordered/);
  assert.equal(await remaining(product,second),25);
  for(const capacity of [-1,1.5,'7',true,1000001])await assert.rejects(api('save_inventory',{rows:[row(second,capacity)]},ids.staff));
  await assert.rejects(api('save_inventory',{rows:[{product_id:product.id,date:second}]},ids.staff));
  await assert.rejects(api('save_inventory',{rows:[row(second,null)]},ids.customer),/staff|authorized|permission|sign in/i);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.save_daily_quantities(jsonb)','execute')"),false);
 })();
 await check('unlimited same-day products obey eligibility, shop closures and cutoff',async()=>{
  const today=await h.day(0);
  await api('quote',checkout(product,today));
  await api('save_settings',{settings:{...original,paused:false,blocked_dates:[today]}},ids.owner);
  await assert.rejects(api('quote',checkout(product,today)),/closed/);
 })();
 await check('daily limits migration upgrades LF/CRLF functions and replays without changing business records or grants',async()=>{
  const migration=(await readFile(new URL('../../supabase/migrations/20260919075336_daily_quantity_limits.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  const patches=[...migration.matchAll(/\('([^']+)',\s+\$old\$([\s\S]*?)\$old\$,\s+\$new\$([\s\S]*?)\$new\$\)/g)];
  assert.equal(patches.length,2);
  const snapshot=async()=> (await db.query(`select
   (select jsonb_agg(to_jsonb(i) order by i.product_id,i.date) from tlb.inventory i) as inventory,
   (select jsonb_agg(to_jsonb(a) order by a.order_id,a.product_id,a.date) from tlb.allocations a) as allocations,
   (select jsonb_agg(to_jsonb(o) order by o.id) from tlb.orders o) as orders,
   (select jsonb_agg(to_jsonb(p) order by p.id) from tlb.payments p) as payments,
   (select jsonb_agg(to_jsonb(e) order by e.id) from tlb.outbox e) as emails`)).rows[0];
  const before=await snapshot();
  for(const crlf of [false,true]){
   for(const [,signature,oldValue,newValue] of patches){
    const installed=(await h.scalar('select pg_get_functiondef($1::regprocedure)',[signature])).replace(/\r\n/g,'\n');
    assert.ok(installed.includes(newValue));
    const historical=installed.replace(newValue,oldValue);
    await db.exec(crlf?historical.replace(/\n/g,'\r\n'):historical);
   }
   await db.exec(crlf?migration.replace(/\n/g,'\r\n'):migration);
   await db.exec(migration);
   assert.deepEqual(await snapshot(),before);
  }
  for(const role of ['anon','authenticated']){
   assert.equal(await h.scalar('select has_function_privilege($1,\'public.shop_api(text,jsonb,text)\',\'execute\')',[role]),true);
   assert.equal(await h.scalar('select has_function_privilege($1,\'tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamptz)\',\'execute\')',[role]),false);
   assert.equal(await h.scalar('select has_function_privilege($1,\'tlb.save_daily_quantities(jsonb)\',\'execute\')',[role]),false);
  }
  const definition=await h.scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");
  assert.ok(definition.indexOf('pg_advisory_xact_lock')<definition.indexOf("p_action='save_inventory'"));
  assert.ok(definition.indexOf('perform tlb.assert_staff(u,false)')<definition.indexOf("p_action='save_inventory'"));
 })();
 await api('save_settings',{settings:original},ids.owner);
}
