import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export default async function ({db,check,state}) {
  const {api,ids,fixture,checkout,item,proof}=state.harness;
  const notifications=id=>db.query("select payload from tlb.outbox where order_id=$1 and event_type='order_review_required' order by to_email",[id]).then(r=>r.rows.map(r=>r.payload));
  const fields=['name','quantity','selection_labels','unit_price_cents','line_total_cents'];
  const {product:snack,date}=await fixture(10,{name:'Nori pouches',price_cents:13000,option_groups:[{
    id:'flavor',label:'Flavor',required_count:1,choices:[{id:'original',label:'Original',surcharge_cents:0},{id:'cheese',label:'Cheese',surcharge_cents:2000}],
  }]});
  const {product:cake}=await fixture(10,{name:'Ube cake',price_cents:225000});
  await api('save_zone',{zone:{name:'Review test delivery',localities:['Review City / Test Barangay'],fee_cents:7500,active:true}},ids.owner);
  const promo=await api('save_promo',{promo:{code:`REVIEW${randomUUID().slice(0,8)}`,kind:'percent',value:10,min_subtotal_cents:0,cap_cents:null,per_account_limit:5,global_limit:10,expires_at:new Date(Date.now()+86400000).toISOString(),active:true}},ids.owner);
  let submitted;
  await check('review email snapshots product quantities, selected options, unit and line prices, promo discount and delivery totals',async()=>{
    submitted=await api('create_order',checkout(snack,date,{items:[item(snack,2,{flavor:{cheese:1}}),item(cake)],promo_code:promo.code,method:'delivery',address:{locality:'Review City / Test Barangay',line1:'123 Test Street'}}),ids.customer);
    assert.equal(submitted.subtotal_cents,255000);
    assert.equal(submitted.discount_cents,25500);
    assert.equal(submitted.delivery_cents,7500);
    assert.equal(submitted.total_cents,237000);
    // A menu edit before proof submission must not rewrite the saved purchase.
    await api('save_product',{product:{...snack,name:'Renamed snack',price_cents:99900}},ids.owner);
    await proof(submitted);
    const messages=await notifications(submitted.id);
    assert.equal(messages.length,2);
    for(const message of messages){
      assert.deepEqual(message.order.items,submitted.items.map(line=>Object.fromEntries(fields.map(key=>[key,line[key]]))));
      for(const key of ['subtotal_cents','discount_cents','delivery_cents','total_cents'])assert.equal(message.order[key],submitted[key]);
      assert.equal(message.order.promo_code,promo.code);
      assert.deepEqual(message.order.items[0].selection_labels,[{group:'Flavor',label:'Cheese',quantity:1,surcharge_cents:2000}]);
      assert.equal('product_id' in message.order.items[0],false);
      assert.equal('selections' in message.order.items[0],false);
      assert.doesNotMatch(JSON.stringify(message),/Renamed snack|access_token|proof_path|payment_instructions/);
    }
  })();
  await check('pickup review emails include explicit zero discount and delivery without inventing a promo',async()=>{
    const pickup=await api('create_order',checkout(cake,date));await proof(pickup);
    const message=(await notifications(pickup.id))[0];
    assert.equal(message.order.subtotal_cents,225000);
    assert.equal(message.order.discount_cents,0);
    assert.equal(message.order.delivery_cents,0);
    assert.equal(message.order.total_cents,225000);
    assert.equal(message.order.promo_code,null);
    assert.deepEqual(message.order.items[0].selection_labels,[]);
  })();
  await check('details migration preserves existing notification payloads and event keys, including legacy retries',async()=>{
    const legacy={event_type:'order_review_required',order:{id:submitted.id,reference:submitted.reference,total_cents:237000},settings:{site_url:'https://example.test'}};
    await db.query("insert into tlb.outbox(event_key,event_type,order_id,to_email,subject,payload,status,attempts,first_attempt_at) values($1,'order_review_required',$2,'owner@example.test','Legacy local fixture',$3,'pending',1,now())",[`legacy-review:${randomUUID()}`,submitted.id,JSON.stringify(legacy)]);
    const snapshot=()=>db.query("select event_key,payload,status,attempts,first_attempt_at from tlb.outbox where event_type='order_review_required' order by event_key").then(r=>r.rows);
    const before=await snapshot();
    await db.exec(await readFile(new URL('../../supabase/migrations/20260918200638_review_email_order_details.sql',import.meta.url),'utf8'));
    assert.deepEqual(await snapshot(),before);
  })();
}
