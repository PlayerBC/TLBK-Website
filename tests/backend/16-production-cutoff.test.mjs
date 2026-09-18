import assert from 'node:assert/strict';

export default async function ({db,check,state}) {
  const {api,ids,fixture,inventory,item,checkout,scalar}=state.harness;
  const saved=(await api('admin_bootstrap',{},ids.owner)).settings;
  const settings=changes=>api('save_settings',{settings:changes},ids.owner);
  const quote=async(product,date,at,changes={})=>(await db.query(
    'select tlb.calculate_quote($1::jsonb,null,null,false,$2::timestamptz) as result',
    [JSON.stringify(checkout(product,date,changes)),at],
  )).rows[0].result;
  try {
    await settings({paused:false,cutoff_time:'12:00',production_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[]});
    const cake=(await fixture(5,{lead_days:2,pickup_only:true})).product;
    const cookie=(await fixture(5,{lead_days:1})).product;
    for(const p of [cake,cookie])for(const date of ['2026-09-20','2026-09-21','2026-09-22'])await inventory(p,date,5);
    const before='2026-09-19T11:59:59.999+08:00',at='2026-09-19T12:00:00+08:00';
    await check('two-day cake quote accepts September 21 before noon and September 22 at noon',async()=>{
      assert.equal((await quote(cake,'2026-09-21',before)).earliest_date,'2026-09-21');
      await assert.rejects(quote(cake,'2026-09-20',before),/Earliest lead-time date: 2026-09-21/);
      await assert.rejects(quote(cake,'2026-09-21',at),/Earliest lead-time date: 2026-09-22/);
      assert.equal((await quote(cake,'2026-09-22',at)).earliest_date,'2026-09-22');
    })();
    await check('mixed baskets honor their longest production requirement regardless of item order',async()=>{
      for(const items of [[item(cookie),item(cake)],[item(cake),item(cookie)]]){
        assert.equal((await quote(cake,'2026-09-21',before,{items})).earliest_date,'2026-09-21');
        await assert.rejects(quote(cake,'2026-09-21',at,{items}),/Earliest lead-time date: 2026-09-22/);
      }
    })();
    await check('revised lead time still enforces production exclusions, stock and fulfillment closures',async()=>{
      await settings({nonproduction_dates:['2026-09-19']});
      await assert.rejects(quote(cake,'2026-09-21',before),/Earliest lead-time date: 2026-09-22/);
      await settings({nonproduction_dates:[],pickup_blocked_dates:['2026-09-21']});
      await assert.rejects(quote(cake,'2026-09-21',before),/unavailable|not available|closed/i);
      await settings({pickup_blocked_dates:[]});
      await inventory(cake,'2026-09-21',0);
      await assert.rejects(quote(cake,'2026-09-21',before),/stock|left|available|capacity|remain/i);
    })();
    await check('lead-time function retains immutable invoker execution and an empty search path',async()=>{
      assert.equal(await scalar("select provolatile='i' and not prosecdef and proconfig @> array['search_path=\"\"'] from pg_proc where oid='tlb.earliest_lead_date(timestamptz,integer,jsonb)'::regprocedure"),true);
    })();
  }finally{await settings(saved)}
}
