import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, fixture, checkout, proof, action, scalar, order } = h;
  const migration = await readFile(new URL('../../supabase/migrations/20260918202752_close_cancelled_payment_reviews.sql', import.meta.url), 'utf8');
  const create = async () => {
    const { product, date } = await fixture(3);
    return { product, date, submitted: await api('create_order', checkout(product, date), ids.customer) };
  };

  await check('cancelling a review closes payment, retains proof, releases stock, and retries once', async () => {
    const { product, date, submitted } = await create();
    await proof(submitted);
    const review = await order(submitted.id);
    const payload = { order_id: review.id, revision: review.revision, reason: 'Customer requested cancellation', idempotency_key: randomUUID() };
    await assert.rejects(api('cancel_order', payload, ids.customer), /staff|owner|authorized|access/i);
    const cancelled = await api('cancel_order', payload, ids.staff);
    assert.equal(cancelled.payment_status, 'cancelled');
    assert.equal(cancelled.fulfillment_status, 'cancelled');
    assert.equal(cancelled.proof_path, review.proof_path);
    assert.equal(cancelled.payment_reference, review.payment_reference);
    assert.equal(cancelled.paid_amount_cents, null);
    assert.equal(cancelled.revision, review.revision + 1);
    assert.equal(await h.remaining(product, date), 3);
    assert.equal((await api('cancel_order', payload, ids.staff)).revision, cancelled.revision);
    assert.equal(await scalar("select count(*)::int from tlb.history where order_id=$1 and action='cancel_order'", [review.id]), 1);
    assert.equal(await scalar("select count(*)::int from tlb.outbox where order_id=$1 and event_type='order_cancelled'", [review.id]), 1);
    assert.equal(await scalar("select payload#>>'{order,payment_status}' from tlb.outbox where order_id=$1 and event_type='order_cancelled'", [review.id]), 'cancelled');
    assert.equal((await api('get_order', { order_id: review.id }, ids.customer)).payment_status, 'cancelled');
    assert.equal((await api('my_orders', {}, ids.customer)).find(o => o.id === review.id).payment_status, 'cancelled');
    await assert.rejects(action('approve_payment', cancelled), /active|review/i);
    await assert.rejects(action('reject_payment', cancelled, { reason: 'Cannot reject a closed review' }), /active|review/i);
    await assert.rejects(proof(submitted), /proof|payment|accepted/i);
  })();

  await check('cancellation closes awaiting payments and refund-label changes cannot reopen a review', async () => {
    for (const withProof of [false, true]) {
      const { submitted } = await create();
      const pending = withProof ? await proof(submitted) : submitted;
      const cancelled = await action('cancel_order', pending, { reason: 'Cancel pending payment' });
      assert.equal(cancelled.payment_status, 'cancelled');
      const labelled = await action('set_refund_label', cancelled, { enabled: true, reason: 'Manual refund record' });
      assert.equal(labelled.payment_status, 'cancelled');
      assert.equal(labelled.fulfillment_status, 'cancelled');
      const restored = await action('set_refund_label', labelled, { enabled: false, reason: 'Remove label' });
      assert.equal(restored.payment_status, 'cancelled');
      assert.equal(restored.paid_amount_cents, null);
    }
  })();

  await check('repair closes legacy cancellations once, preserving paid/rejected orders and all financial records', async () => {
    const legacy = [];
    for (const withProof of [false, true]) {
      const { submitted } = await create();
      const pending = withProof ? await proof(submitted) : submitted;
      const cancelled = await action('cancel_order', pending, { reason: 'Legacy fixture' });
      await db.query('update tlb.orders set payment_status=$2,refund_label=$3 where id=$1', [cancelled.id, pending.payment_status, withProof]);
      legacy.push(await order(cancelled.id));
    }
    const paid = await action('approve_payment', await proof((await create()).submitted));
    const paidCancelled = await action('cancel_order', paid, { reason: 'Paid fixture', restore_stock: false });
    const rejected = await action('reject_payment', await proof((await create()).submitted), { reason: 'Invalid proof fixture' });
    const activeResult = await proof((await create()).submitted);
    const active = await order(activeResult.id);
    const snapshots = async () => ({
      payments: (await db.query('select * from tlb.payments order by id')).rows,
      allocations: (await db.query('select * from tlb.allocations order by order_id,product_id,date')).rows,
      promos: (await db.query('select * from tlb.promo_usage order by order_id')).rows,
      outbox: (await db.query('select * from tlb.outbox order by id')).rows,
    });
    const unchanged = await snapshots();
    const definition = await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");
    await db.exec(migration.replace(/\r\n/g, '\n'));
    for (const before of legacy) {
      const after = await order(before.id);
      assert.deepEqual({ ...after, payment_status: before.payment_status, revision: before.revision, history: before.history }, before);
      assert.equal(after.payment_status, 'cancelled');
      assert.equal(after.revision, before.revision + 1);
      const audit = after.history.at(-1);
      assert.equal(audit.action, 'payment_review_closed');
      assert.equal(audit.before.payment_status, before.payment_status);
      assert.equal(audit.after.payment_status, 'cancelled');
    }
    assert.deepEqual(await order(paidCancelled.id), paidCancelled);
    assert.deepEqual(await order(rejected.id), rejected);
    assert.deepEqual(await order(active.id), active);
    assert.deepEqual(await snapshots(), unchanged);
    const afterFirst = await Promise.all(legacy.map(o => order(o.id)));
    await db.exec(migration.replace(/\r?\n/g, '\r\n'));
    assert.deepEqual(await Promise.all(legacy.map(o => order(o.id))), afterFirst);
    assert.equal(await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)"), definition);
    assert.equal(await scalar("select count(*)::int from tlb.orders where fulfillment_status='cancelled' and payment_status in ('awaiting_payment','under_review')"), 0);
  })();
}
