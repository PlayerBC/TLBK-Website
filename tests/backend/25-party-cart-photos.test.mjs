import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default async function({ db, check, state }) {
  const h = state.harness;
  const api = (action, payload = {}, user = h.ids.owner) => h.as(user, async () => (await db.query('select public.party_cart_photos_api($1,$2::jsonb) as result', [action, JSON.stringify(payload)])).rows[0].result);
  const seed = JSON.parse(await readFile(new URL('../party-cart-photos-seed.json', import.meta.url), 'utf8'));
  let current, otherContent;
  const unchangedContent = async () => (await db.query('select (select jsonb_agg(to_jsonb(p) order by id) from tlb.party_packages p) as packages, (select jsonb_agg(to_jsonb(s)) from tlb.party_package_settings s) as settings')).rows;
  await check('party cart photos: all 17 existing photos retained and safe public projection', async () => {
    current = await api('admin_get'); assert.deepEqual(current.items, seed); assert.equal(current.revision, 1);
    const publicData = await api('browse', {}, null); assert.equal(publicData.items.length, 17);
    assert.deepEqual(Object.keys(publicData), ['items']);
    assert.deepEqual(Object.keys(publicData.items[0]).sort(), ['caption','id','photo_url']);
    otherContent = await unchangedContent();
  })();
  await check('party cart photos: only verified owners can read drafts and save; table stays private', async () => {
    for (const user of [null, h.ids.staff, h.ids.customer, h.ids.unverified]) {
      for (const action of ['admin_get','save']) await assert.rejects(api(action, {}, user), /verified|owner/i);
      await assert.rejects(h.as(user, () => db.query('select * from tlb.party_cart_gallery')), /permission denied/);
    }
  })();
  await check('party cart photos: reorder, upload link, caption and visibility persist atomically', async () => {
    const items = [...current.items].reverse(); items[0] = { ...items[0], caption: 'Updated caption', published: false };
    items.push({ id: randomUUID(), photo_url: `https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/${h.ids.owner}/${randomUUID()}.webp`, caption: '', published: true });
    const payload = { items, revision: current.revision, operation_id: randomUUID() };
    current = await api('save', payload); assert.deepEqual(current.items, items);
    assert.deepEqual(await api('save', payload), current);
    assert.equal(current.revision, 2); assert.equal((await api('browse', {}, null)).items.length, 17);
    assert(!(await api('browse', {}, null)).items.some(p => p.id === items[0].id));
    await assert.rejects(api('save', { ...payload, operation_id: randomUUID() }), /changed/);
    assert.deepEqual(await unchangedContent(), otherContent);
  })();
  await check('party cart photos: bad links, duplicate IDs, missing fields and invalid metadata rejected', async () => {
    const first = current.items[0];
    const bad = [null, {}, [first,first], [{...first,id:'invalid'}], [{...first,caption:'x'.repeat(201)}], [{...first,published:'true'}], [{...first,published:null}], [{...first,caption:null}], [{...first,extra:'unexpected'}], [{...first,photo_url:'javascript:alert(1)'}], [{...first,photo_url:'assets/partycart/../../secrets.jpg'}], [{...first,photo_url:'https://example.com/photo.webp'}], [{...first,photo_url:first.photo_url+'?evil'}], Array.from({length:501},()=>({...first,id:randomUUID()}))];
    for (const items of bad) await assert.rejects(api('save', { items, revision: current.revision, operation_id: randomUUID() }), /valid image/);
    await assert.rejects(api('save', { items: current.items, revision: current.revision }), /refresh/i);
    assert.deepEqual(await api('admin_get'), current);
  })();
  await check('party cart photos: a stale retry cannot overwrite subsequent saves; empty gallery allowed', async () => {
    const payload = { items: current.items.slice(1), revision: current.revision, operation_id: randomUUID() };
    current = await api('save', payload);
    current = await api('save', { items: [], revision: current.revision, operation_id: randomUUID() });
    await assert.rejects(api('save', payload), /changed/);
    assert.deepEqual(await api('browse', {}, null), { items: [] });
    assert.deepEqual(await unchangedContent(), otherContent);
  })();
}
