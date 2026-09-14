import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, action, proof, service } = h;

  await check('outbox leases exclude another worker and sent records cannot be claimed again', async () => {
    const first = await service('claim_emails', { limit: 3 });
    const second = await service('claim_emails', { limit: 3 });
    assert.equal(first.length, 3);
    assert.equal(second.length, 3);
    assert.equal(first.some(a => second.some(b => a.id === b.id)), false);
    const claimed = first[0];
    await assert.rejects(service('email_sent', { id: claimed.id, lease_token: randomUUID(), provider_id: 'QA-invalid-lease' }), /stale|claim|worker/i);
    const ready = await service('prepare_email', { id: claimed.id, lease_token: claimed.lease_token });
    assert.equal(ready.event_key, claimed.event_key);
    assert.equal(ready.payload.order.id, claimed.payload.order.id);
    await service('email_sent', { id: claimed.id, lease_token: claimed.lease_token, provider_id: 'QA-provider-accepted' });
    assert.equal(await h.scalar('select status from tlb.outbox where id=$1', [claimed.id]), 'sent');
    const later = await service('claim_emails', { limit: 10 });
    assert.equal(later.some(row => row.id === claimed.id), false);
    assert.equal(await h.scalar('select provider_id from tlb.outbox where id=$1', [claimed.id]), 'QA-provider-accepted');
  })();

  await check('failed email attempts retain errors, apply retry delay and stop before the provider idempotency window', async () => {
    const claimed = (await db.query("select id::text, lease_token::text from tlb.outbox where status='sending' limit 1")).rows[0];
    assert.ok(claimed);
    await service('email_failed', { ...claimed, error: 'QA simulated provider failure' });
    const failed = (await db.query('select status,last_error,available_at>clock_timestamp() as delayed,lease_token from tlb.outbox where id=$1', [claimed.id])).rows[0];
    assert.deepEqual(failed, { status: 'pending', last_error: 'QA simulated provider failure', delayed: true, lease_token: null });
    assert.equal((await service('claim_emails', { limit: 10 })).some(row => row.id === claimed.id), false);
    await db.query("update tlb.outbox set first_attempt_at=clock_timestamp()-interval '24 hours', available_at=clock_timestamp()-interval '1 minute' where id=$1", [claimed.id]);
    await service('claim_emails', { limit: 10 });
    assert.equal(await h.scalar('select status from tlb.outbox where id=$1', [claimed.id]), 'failed');
    assert.match(await h.scalar('select last_error from tlb.outbox where id=$1', [claimed.id]), /idempotency|review/i);
  })();

  await check('due reminders have a durable order/date key and are rechecked after cancellation', async () => {
    // Retire earlier fixture emails locally so this scenario can claim exactly
    // its reminder. No provider is contacted anywhere in this suite.
    await db.exec("update tlb.outbox set status='skipped',lease_token=null,leased_until=null where status in ('pending','sending')");
    const { product, date } = await fixture();
    const submitted = await api('create_order', checkout(product, date));
    const paid = await action('approve_payment', await proof(submitted));
    const today = await h.day(0);
    await h.inventory(product, today, 10);
    const due = await action('edit_order', paid, { reason: 'Move to the test reminder date', changes: { fulfillment_date: today } });
    await api('save_settings', { settings: { reminders_enabled: true, reminder_time: '00:00' } }, ids.owner);
    await service('maintenance');
    await service('maintenance');
    assert.equal(await h.scalar("select count(*)::int from tlb.outbox where order_id=$1 and event_type='fulfillment_reminder'", [due.id]), 1);
    await db.query("update tlb.outbox set status='skipped' where order_id=$1 and event_type<>'fulfillment_reminder'", [due.id]);
    const reminder = (await service('claim_emails', { limit: 10 })).find(row => row.payload.event_type === 'fulfillment_reminder');
    assert.ok(reminder);
    assert.match(reminder.event_key, new RegExp(`${due.id}:${today}$`));
    await action('cancel_order', due, { reason: 'Cancel after worker claim', restore_stock: true });
    const prepared = await service('prepare_email', { id: reminder.id, lease_token: reminder.lease_token });
    assert.equal(prepared.skip, true);
    assert.equal(await h.scalar('select status from tlb.outbox where id=$1', [reminder.id]), 'skipped');
  })();
}
