import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export default async function({ db, check, state }) {
  const h = state.harness;
  const api = (action, payload = {}, user = h.ids.owner) => h.as(user, async () => (await db.query('select public.party_packages_api($1,$2::jsonb) as result', [action, JSON.stringify(payload)])).rows[0].result);
  const save = item => api('save', { package: item, operation_id: randomUUID() });
  const fixture = published => ({ id: randomUUID(), revision: 0, name: 'Delete test package', subtitle: '', price_cents: 900000, badge: '', features: [{ label: '50 treats', detail: '' }], published, sort_order: 10 });
  let item, hidden, before, settings;
  await check('package deletion: only verified owners can delete; direct table deletion stays blocked', async () => {
    item = await save(fixture(true)); hidden = await save(fixture(false));
    before = await api('admin_list');
    settings = (await db.query('select to_jsonb(s) as settings from tlb.party_package_settings s')).rows[0].settings;
    for (const user of [null, h.ids.staff, h.ids.customer, h.ids.unverified]) {
      await assert.rejects(api('delete', { id: item.id, revision: item.revision }, user), /verified|owner/i);
      await assert.rejects(api('delete', { id: randomUUID(), revision: 1 }, user), /verified|owner/i);
    }
    await assert.rejects(h.as(h.ids.owner, () => db.query('delete from tlb.party_packages where id = $1', [item.id])), /permission denied/);
    assert.deepEqual(await api('admin_list'), before);
  })();
  await check('package deletion: malformed and missing IDs or revisions cannot remove data', async () => {
    for (const payload of [{}, { revision: 1 }, { id: 'invalid', revision: 1 }, { id: item.id }, ...[null, 0, -1, 1.5, '1'].map(revision => ({ id: item.id, revision }))]) {
      await assert.rejects(api('delete', payload), /package|refresh|uuid/i);
    }
    assert.deepEqual(await api('admin_list'), before);
  })();
  await check('package deletion: an edit from another window prevents stale deletion', async () => {
    const stale = item;
    item = await save({ ...item, name: 'Recently edited package' });
    await assert.rejects(api('delete', { id: stale.id, revision: stale.revision }), /changed.*refresh/i);
    assert.equal((await api('browse', {}, null)).items.find(p => p.id === item.id).name, item.name);
  })();
  await check('package deletion: owner deletion removes only the selected package from both lists', async () => {
    const result = await api('delete', { id: item.id, revision: item.revision });
    assert.deepEqual(result, { id: item.id, deleted: true });
    assert(!(await api('browse', {}, null)).items.some(p => p.id === item.id));
    assert.deepEqual((await api('admin_list')).items, before.items.filter(p => p.id !== item.id));
    assert.deepEqual((await db.query('select to_jsonb(s) as settings from tlb.party_package_settings s')).rows[0].settings, settings);
  })();
  await check('package deletion: retry after lost response succeeds and a stale edit cannot restore it', async () => {
    assert.deepEqual(await api('delete', { id: item.id, revision: item.revision }), { id: item.id, deleted: true });
    await assert.rejects(save({ ...item, name: 'Stale edit' }), /not found/i);
    assert(!(await api('admin_list')).items.some(p => p.id === item.id));
  })();
  await check('package deletion: hidden packages can also be deleted', async () => {
    await api('delete', { id: hidden.id, revision: hidden.revision });
    assert(!(await api('admin_list')).items.some(p => p.id === hidden.id));
  })();
}
