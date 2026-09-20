import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export default async function({ db, check, state }) {
  const h=state.harness;
  const api=(action,payload={},user=h.ids.owner)=>h.as(user,async()=>(await db.query('select public.party_cart_items_api($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result);
  const packages=()=>h.as(h.ids.owner,async()=>(await db.query("select public.party_packages_api('admin_list','{}'::jsonb) as result")).rows[0].result);
  let current;
  await check('cart items: seeds all 12 existing options and exposes only names publicly',async()=>{
    current=await api('admin_get');
    assert.deepEqual(current.items,['Cookie A La Mode','Custom Character Marshmallows (For Cookie A La Mode Topping)','Nori Chips Cups','Gourmet Cookie Nibblers','French Macarons (Plain or Character Design)','Cream Puffs (Vanilla / Ube)','Brownies / Cheesecake Brownie Bites','Coconut Macaroons','Cheese Custaroons','Tiramisu Cups','Cheesecake Bites','Panna Cotta Cups']);
    const result=await api('browse',{},null);assert.deepEqual(Object.keys(result),['items']);assert.deepEqual(result.items,current.items);
    for(const user of [null,h.ids.staff,h.ids.customer,h.ids.unverified])for(const action of ['admin_get','save'])await assert.rejects(api(action,{},user),/verified|owner/i);
  })();
  await check('cart items: editing, reordering, adding, removal and safe retries',async()=>{
    const before=await packages();
    const payload={items:['New treat','Updated nori cups',...current.items.slice(4)],revision:current.revision,operation_id:randomUUID()};
    current=await api('save',payload);assert.equal(current.revision,2);assert.deepEqual(current.items,payload.items);
    assert.deepEqual(await api('save',payload),current);
    await assert.rejects(api('save',{...payload,operation_id:randomUUID()}),/changed/);
    assert.deepEqual(await packages(),before);
    const old=current;current=await api('save',{items:['One choice'],revision:current.revision,operation_id:randomUUID()});
    await assert.rejects(api('save',{items:old.items,revision:old.revision,operation_id:randomUUID()}),/changed/);
  })();
  await check('cart items: invalid values are rejected and an empty list is allowed',async()=>{
    for(const items of [null,{},[''],['   '],[1],[null],[{name:'x'}],['x'.repeat(201)],Array(101).fill('x')])await assert.rejects(api('save',{items,revision:current.revision,operation_id:randomUUID()}),/items/i);
    assert.deepEqual(await api('admin_get'),current);
    current=await api('save',{items:[],revision:current.revision,operation_id:randomUUID()});assert.deepEqual((await api('browse',{},null)).items,[]);
    await assert.rejects(h.as(h.ids.customer,()=>db.query("update tlb.party_package_settings set cart_items='[]'")),/permission denied/);
  })();
}
