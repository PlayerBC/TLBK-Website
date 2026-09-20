import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export default async function({ db, check, state }) {
  const h = state.harness;
  const api = (action, payload = {}, user = h.ids.owner) => h.as(user, async () => (await db.query('select public.party_packages_api($1,$2::jsonb) as result', [action, JSON.stringify(payload)])).rows[0].result);
  const save = (item, operation_id = randomUUID()) => api('save', { package: item, operation_id });
  let initial, item;
  await check('party packages: exact four existing packages and public-only fields', async () => {
    initial = await api('admin_list');
    const publicData = await api('browse', {}, null);
    assert.deepEqual(publicData.items.map(p => [p.name,p.price_cents,p.features.length]), [['Package 1',900000,3],['Package 2',900000,2],['Package 3',1050000,4],['Package 4',900000,2]]);
    assert.equal(publicData.items[2].badge, 'Most Popular');
    assert(publicData.items[3].features[1].detail.includes("S'mores"));
    assert.deepEqual(Object.keys(publicData.items[0]).sort(), ['badge','features','id','name','price_cents','subtitle']);
    assert.deepEqual(Object.keys(publicData.settings), ['inclusions']);
    assert.equal(publicData.settings.inclusions[3].detail, 'Excluding Novaliches & Payatas');
  })();
  await check('party packages: only a verified owner can administer; tables remain private', async () => {
    for (const user of [null,h.ids.staff,h.ids.customer,h.ids.unverified]) {
      for (const action of ['admin_list','save','save_settings']) await assert.rejects(api(action, {}, user), /verified|owner/i);
      for (const table of ['party_packages','party_package_settings']) await assert.rejects(h.as(user, () => db.query(`select * from tlb.${table}`)), /permission denied/);
      await assert.rejects(h.as(user, () => db.query("insert into tlb.party_packages(name,price_cents,features) values ('Invalid',100,'[]')")), /permission denied/);
    }
  })();
  await check('party packages: create/update retries do not duplicate or overwrite newer edits', async () => {
    const added = { id: randomUUID(), revision:0, name:'QA package', subtitle:'Party favorite', price_cents:1250050, badge:'New', published:true, sort_order:0, features:[{label:'120 treats',detail:'Choose your flavors'}] };
    const operation = randomUUID(); item = await save(added, operation);
    assert.deepEqual(await save(added, operation), item);
    assert.equal((await api('admin_list')).items.length, 5);
    const next = { ...item, price_cents:1500000, badge:'Popular' }, secondOperation = randomUUID();
    item = await save(next, secondOperation);
    assert.deepEqual(await save(next, secondOperation), item);
    await assert.rejects(save(added, operation), /changed/);
    await assert.rejects(save(next), /changed/);
    assert.equal((await api('browse', {}, null)).items[0].price_cents, 1500000);
  })();
  await check('party packages: hidden status, order and shared inclusions persist', async () => {
    item = await save({ ...item, published:false });
    assert(!(await api('browse', {}, null)).items.some(p => p.id === item.id));
    assert((await api('admin_list')).items.some(p => p.id === item.id));
    item = await save({ ...item, published:true, sort_order:500 });
    assert.equal((await api('browse', {}, null)).items.at(-1).id, item.id);
    const settings = { revision:1, inclusions:[{label:'Updated inclusion',detail:'Saved details'}], operation_id:randomUUID() };
    const updated = await api('save_settings',settings);
    assert.deepEqual(await api('save_settings',settings),updated);
    await assert.rejects(api('save_settings',{...settings,operation_id:randomUUID()}), /changed/);
    assert.deepEqual((await api('browse', {}, null)).settings.inclusions,settings.inclusions);
  })();
  await check('party packages: invalid prices, structure, visibility and orders rejected', async () => {
    for (const price_cents of [-1,0,1.5,100000001,'900000',null]) await assert.rejects(save({...item,price_cents}), /price/i);
    for (const features of [null,[],[{label:'x',detail:7}],[{label:'',detail:''}],[{label:'x',detail:'',hidden:'extra'}],[{label:'x'}],Array.from({length:31},()=>({label:'x',detail:''}))]) await assert.rejects(save({...item,features}), /inclusion/i);
    for (const sort_order of [-1,1.5,10001,'10']) await assert.rejects(save({...item,sort_order}), /order/i);
    await assert.rejects(save({...item,name:'   '}), /name/i);
    await assert.rejects(save({...item,published:'true'}), /show/i);
    await assert.rejects(save({...item,badge:'x'.repeat(33)}), /badge/i);
    await assert.rejects(api('save_settings',{revision:2,inclusions:[],operation_id:randomUUID()}), /inclusion/i);
    assert.equal((await api('admin_list')).items.find(p => p.id === item.id).revision,item.revision);
  })();
  await check('party packages: no visible packages returns an empty catalogue', async () => {
    for (const p of (await api('admin_list')).items) await save({...p,published:false});
    assert.deepEqual((await api('browse',{},null)).items,[]);
  })();
}
