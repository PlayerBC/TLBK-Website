import assert from 'node:assert/strict';

export default async function({ db, check, state }) {
  const h = state.harness;
  const api = (action, payload = {}, user = h.ids.owner) => h.as(user, async () => (await db.query('select public.gallery_api($1,$2::jsonb) as result', [action, JSON.stringify({ gallery: 'custom-orders', ...payload })])).rows[0].result);
  const base = { category: 'Character cakes', photo_url: 'https://example.test/pikachu.webp', keywords: ['Pikachu', 'Pokémon'], title: '', description: '' };
  let photo;
  await check('gallery: owner-only editing and no direct table access', async () => {
    for (const user of [null, h.ids.customer, h.ids.staff, h.ids.unverified]) {
      for (const action of ['save', 'import', 'delete', 'set_enabled', 'admin_list']) await assert.rejects(api(action, { photo: base }, user), /owner|verified/i);
      await assert.rejects(h.as(user, () => db.query('select * from tlb.gallery_photos')), /permission denied/i);
    }
    photo = await api('save', { photo: base });
    assert.equal(photo.title, ''); assert.equal(photo.description, '');
    assert.deepEqual((await api('browse', {}, null)).items, []);
  })();
  await check('gallery: public keyword search is accent insensitive without revealing tags', async () => {
    await api('set_enabled', { enabled: true, revision: 1 });
    for (const query of ['Pokemon', 'POKÉMON', 'Pika', 'Pikachu pokemon']) {
      const result = await api('browse', { query }, null);
      assert.equal(result.total, 1); assert.equal(result.items[0].id, photo.id);
      assert.deepEqual(Object.keys(result.items[0]).sort(), ['category','description','id','photo_url','title']);
    }
    assert.equal((await api('browse', { query: '% _ ! | &' }, null)).total, 0);
  })();
  await check('gallery: every search match is reachable past the old 24-photo cap', async () => {
    const photos = Array.from({ length: 62 }, (_, n) => ({ ...base, legacy_id: `mongo-${n}`, sort_order: n + 1 }));
    assert.equal((await api('import', { photos, categories: ['Character cakes'] })).added, 62);
    const all = [];
    for (const offset of [0, 24, 48]) {
      const result = await api('browse', { query: 'pokemon', offset }, null);
      assert.equal(result.total, 63); all.push(...result.items);
    }
    assert.equal(all.length, 63); assert.equal(new Set(all.map(p => p.id)).size, 63);
    assert.equal((await api('browse', { query: 'pokemon', offset: 72 }, null)).items.length, 0);
    assert.equal((await api('import', { photos })).skipped, 62);
  })();
  await check('gallery: hidden photos and separate pastry gallery stay isolated', async () => {
    await api('save', { photo: { ...base, category: 'Secret category', published: false, keywords: ['Secret'] } });
    const pastry = await api('save', { gallery: 'pastries', photo: base });
    const all = await api('browse', {}, null);
    assert(!all.items.some(item => item.id === pastry.id)); assert(!all.categories.includes('Secret category'));
    assert.equal((await api('browse', { query: 'secret' }, null)).total, 0);
    assert.equal((await api('admin_list', { query: 'secret' })).total, 1);
    assert.equal((await api('browse', { gallery: 'pastries' }, null)).enabled, false);
  })();
  await check('gallery: imports preserve later edits and roll back invalid batches', async () => {
    const imported = (await api('admin_list', { offset: 24 })).items.find(p => p.legacy_id);
    await api('save', { photo: { ...imported, title: 'Edited after import' } });
    await api('import', { photos: [{ ...base, legacy_id: imported.legacy_id }] });
    assert.equal((await api('admin_list', { query: 'Edited' })).items[0].title, 'Edited after import');
    await assert.rejects(api('import', { photos: [{ ...base, legacy_id: 'rollback-valid' }, { ...base, legacy_id: 'rollback-invalid', category: '' }] }), /category/);
    assert.equal(await h.scalar("select count(*) from tlb.gallery_photos where legacy_id like 'rollback-%'"), 0);
  })();
  await check('gallery: stale edits, cross-gallery mutations and invalid fields are rejected', async () => {
    const updated = await api('save', { photo: { ...photo, title: 'New title' } });
    await assert.rejects(api('save', { photo }), /changed/);
    await assert.rejects(api('delete', { id: photo.id, revision: photo.revision }), /changed/);
    await assert.rejects(api('delete', { gallery: 'pastries', id: photo.id, revision: updated.revision }), /changed/);
    await assert.rejects(api('save', { photo: { ...base, photo_url: 'javascript:alert(1)' } }), /secure/);
    await assert.rejects(api('save', { photo: { ...base, keywords: [{ tag: 'wrong' }] } }), /keyword/i);
    await assert.rejects(api('save', { photo: { ...base, keywords: ['x'.repeat(101)] } }), /keyword/i);
    await api('delete', { id: updated.id, revision: updated.revision });
    await assert.rejects(api('set_enabled', { enabled: false, revision: 1 }), /changed/);
  })();
}
