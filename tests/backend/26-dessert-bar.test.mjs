import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export default async function({ db, check, state }) {
  const h = state.harness;
  const api = (kind, action, payload = {}, user = h.ids.owner) => h.as(user, async () =>
    (await db.query('select public.dessert_bar_' + kind + '_api($1,$2::jsonb) as result', [action, JSON.stringify(payload)])).rows[0].result);
  const partySnapshot = async () => (await db.query("select (select coalesce(jsonb_agg(p order by id),'[]') from tlb.party_packages p) as packages, (select to_jsonb(s) from tlb.party_package_settings s) as settings, (select to_jsonb(g) from tlb.party_cart_gallery g) as gallery")).rows[0];
  const before = await partySnapshot();
  let item, settings, photos, cart;
  await check('dessert bar: starts empty with independent settings and invoker public APIs', async () => {
    assert.deepEqual(await api('packages','browse',{},null), { items:[], settings:{inclusions:[]} });
    assert.deepEqual(await api('items','browse',{},null), {items:[]});
    assert.deepEqual(await api('photos','browse',{},null), {items:[]});
    settings = (await api('packages','admin_list')).settings;
    photos = await api('photos','admin_get'); cart = await api('items','admin_get');
    const funcs = (await db.query("select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'dessert_bar_%_api'")).rows;
    assert.equal(funcs.length,3); assert(funcs.every(f=>!f.prosecdef));
  })();
  await check('dessert bar: verified owner required for every write and administrative read', async () => {
    for (const user of [null,h.ids.staff,h.ids.customer,h.ids.unverified]) {
      for (const [kind,actions] of [['packages',['admin_list','save','delete','save_settings']],['items',['admin_get','save']],['photos',['admin_get','save']]]) {
        for (const action of actions) await assert.rejects(api(kind,action,{},user), /verified|owner/i);
      }
      for (const table of ['dessert_bar_packages','dessert_bar_settings','dessert_bar_gallery']) {
        await assert.rejects(h.as(user,()=>db.query('select * from tlb.'+table)), /permission denied/);
        await assert.rejects(h.as(user,()=>db.query('delete from tlb.'+table)), /permission denied/);
      }
    }
  })();
  await check('dessert bar: package create/edit/hide/delete protects retries and concurrent edits', async () => {
    const draft={id:randomUUID(),revision:0,name:'Dessert celebration',subtitle:'',price_cents:1500000,badge:'New',features:[{label:'100 treats',detail:'Pick your favorites'}],published:true,sort_order:10};
    const save=(p,operation_id=randomUUID())=>api('packages','save',{package:p,operation_id});
    const operation=randomUUID(); item=await save(draft,operation);
    assert.deepEqual(await save(draft,operation),item);
    assert.equal((await api('packages','browse',{},null)).items[0].name,draft.name);
    const previous=item; item=await save({...item,published:false});
    assert.deepEqual((await api('packages','browse',{},null)).items,[]);
    await assert.rejects(save(previous),/changed/);
    await assert.rejects(api('packages','delete',{id:item.id,revision:previous.revision}),/changed/);
    await assert.rejects(save({...item,price_cents:0}),/price/i);
    await assert.rejects(save({...item,features:[]}),/inclusion/i);
    await api('packages','delete',{id:item.id,revision:item.revision});
    assert.equal((await api('packages','delete',{id:item.id,revision:item.revision})).deleted,true);
  })();
  await check('dessert bar: shared inclusions and customization items can be saved, ordered and cleared', async () => {
    const payload={...settings,inclusions:[{label:'Display setup',detail:'Chosen by owner'}],operation_id:randomUUID()};
    settings=await api('packages','save_settings',payload);
    assert.deepEqual(await api('packages','save_settings',payload),settings);
    await assert.rejects(api('packages','save_settings',{...payload,operation_id:randomUUID()}),/changed/);
    settings=await api('packages','save_settings',{...settings,inclusions:[],operation_id:randomUUID()});
    assert.deepEqual(settings.inclusions,[]);
    const cp={...cart,items:['Tiramisu cups','Brownie bites'],operation_id:randomUUID()};
    cart=await api('items','save',cp); assert.deepEqual(await api('items','save',cp),cart);
    assert.deepEqual((await api('items','browse',{},null)).items,cp.items);
    await assert.rejects(api('items','save',{...cart,items:[''],operation_id:randomUUID()}),/name/i);
    await api('items','save',{...cart,items:[],operation_id:randomUUID()});
  })();
  await check('dessert bar: photos keep order and visibility; stale or invalid saves cannot replace content', async () => {
    const photo=caption=>({id:randomUUID(),photo_url:'https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/'+randomUUID()+'/'+randomUUID()+'.webp',caption,published:true});
    const first=photo('First dessert photo'),second=photo('Second dessert photo');
    const payload={...photos,items:[first,second],operation_id:randomUUID()};
    photos=await api('photos','save',payload);
    assert.deepEqual(await api('photos','save',payload),photos);
    photos=await api('photos','save',{...photos,items:[second,{...first,published:false}],operation_id:randomUUID()});
    const publicPhotos=(await api('photos','browse',{},null)).items;
    assert.deepEqual(publicPhotos,[{id:second.id,photo_url:second.photo_url,caption:second.caption}]);
    await assert.rejects(api('photos','save',{...payload,operation_id:randomUUID()}),/changed/);
    await assert.rejects(api('photos','save',{...photos,items:[{...first,photo_url:'javascript:alert(1)'}],operation_id:randomUUID()}),/valid image/i);
    await assert.rejects(api('photos','save',{...photos,items:[first,first],operation_id:randomUUID()}),/unique photos/i);
    await api('photos','save',{...photos,items:[],operation_id:randomUUID()});
    assert.deepEqual(await api('photos','browse',{},null),{items:[]});
    assert.deepEqual(await partySnapshot(),before);
  })();
}
