import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeHarness } from './helpers.mjs';

export default async function ({ db, check, state }) {
  const h = await makeHarness(db);
  state.harness = h;
  const { api, ids, item, checkout, fixture, inventory, action, proof, remaining, order } = h;

  await check('live backend starts empty, paused, and with private owner settings omitted', async () => {
    const catalog = await api('catalog');
    assert.equal(catalog.products.length, 0);
    assert.equal(catalog.settings.paused, true);
    assert.equal('owner_email' in catalog.settings, false);
    const { product, date } = await fixture();
    await assert.rejects(api('create_order', checkout(product, date)), /paused|setup|ordering/i);
  })();

  await check('ordering cannot be opened before real operational settings are supplied', async () => {
    await assert.rejects(api('save_settings', { settings: { paused: false } }, ids.owner), /payment|pickup|contact|site|config|setting|opening|unpause/i);
    assert.equal((await api('catalog')).settings.paused, true);
  })();

  const initial = await api('admin_bootstrap', {}, ids.owner);
  await api('save_settings', { settings: {
    ...initial.settings, paused: false, pickup_address: 'QA test address',
    payment_instructions: 'QA fixture instructions', owner_email: 'owner@example.test',
    contact_email: 'owner@example.test', site_url: 'https://example.test',
  } }, ids.owner);
  await api('save_zone', { zone: { name: 'QA delivery area', localities: ['QA City / QA Barangay'], fee_cents: 1500, active: true } }, ids.owner);

  await check('pickup and delivery share explicit per-date inventory; quote holds nothing', async () => {
    const { product, date } = await fixture(5);
    const payload = checkout(product, date, { items: [item(product, 2)] });
    const quote = await api('quote', payload);
    assert.equal(quote.total_cents, 20000);
    assert.equal(await remaining(product, date), 5);
    await api('create_order', payload);
    const delivery = await api('create_order', checkout(product, date, {
      items: [item(product, 2)], method: 'delivery', address: { locality: 'QA City / QA Barangay', line1: '123 QA Street' },
    }));
    assert.equal(delivery.total_cents, 21500);
    assert.equal(await remaining(product, date), 1);
    await assert.rejects(api('create_order', checkout(product, date, { items: [item(product, 2)] })), /stock|capacity|available|remain/i);
    assert.equal(await remaining(product, date), 1);
    await assert.rejects(api('quote', checkout(product, await h.day(31))), /stock|capacity|available|date/i);
  })();

  await check('a price change after review rejects the stale quote atomically without creating an order or allocation', async () => {
    const { product, date } = await fixture(3);
    const payload = checkout(product, date, { items: [item(product, 2)] });
    const expected = q => Object.fromEntries(['items', 'subtotal_cents', 'discount_cents', 'delivery_cents', 'total_cents'].map(key => [key, q[key]]));
    payload.expected_quote = expected(await api('quote', payload));
    await api('save_product', { product: { ...product, price_cents: product.price_cents + 1000 } }, ids.owner);
    await assert.rejects(api('create_order', payload), /Prices or availability changed since review\. Review your order again\./);
    assert.equal(await remaining(product, date), 3);
    assert.equal(await h.scalar('select count(*)::int from tlb.orders where idempotency_key=$1', [payload.idempotency_key]), 0);
    assert.equal(await h.scalar('select count(*)::int from tlb.allocations where product_id=$1', [product.id]), 0);
    payload.expected_quote = expected(await api('quote', payload));
    const accepted = await api('create_order', payload);
    assert.equal(accepted.total_cents, 22000);
    assert.equal(await remaining(product, date), 1);
    assert.equal((await api('create_order', payload)).id, accepted.id);
  })();

  await check('order submission retries preserve order, access token, inventory and one email event', async () => {
    const { product, date } = await fixture(3);
    const payload = checkout(product, date, { items: [item(product, 2)] });
    const first = await api('create_order', payload);
    const retry = await api('create_order', payload);
    assert.equal(retry.id, first.id);
    assert.equal(retry.access_token, first.access_token);
    assert.ok(first.access_token.length >= 40);
    assert.equal(await remaining(product, date), 1);
    assert.equal(await h.scalar('select count(*)::int from tlb.outbox where order_id=$1 and event_type=$2', [first.id, 'order_submitted']), 1);
    await assert.rejects(api('create_order', { ...payload, instructions: 'Changed retry' }), /idempotenc|different|reused|retry/i);
    assert.equal(await remaining(product, date), 1);
  })();

  await check('guest order access requires its token and never attaches by matching email', async () => {
    const { product, date } = await fixture();
    const guest = await api('create_order', checkout(product, date));
    await assert.rejects(api('get_order', { order_id: guest.id }, ids.customer), /access|authorized|found|permission/i);
    await assert.rejects(api('get_order', { order_id: guest.id }, null, 'x'.repeat(64)), /access|authorized|found|permission/i);
    assert.equal((await api('get_order', { order_id: guest.id }, null, guest.access_token)).id, guest.id);
    assert.equal((await api('my_orders', {}, ids.customer)).some(o => o.id === guest.id), false);
  })();

  await check('timely proof stops expiry indefinitely; approval commits once and retry is idempotent', async () => {
    const { product, date } = await fixture(5);
    const submitted = await api('create_order', checkout(product, date, { items: [item(product, 2)] }));
    const review = await proof(submitted);
    assert.equal(review.payment_status, 'under_review');
    await db.query("update tlb.orders set payment_deadline=clock_timestamp()-interval '2 days' where id=$1", [submitted.id]);
    await db.query('select tlb.expire_orders()');
    assert.equal((await order(submitted.id)).payment_status, 'under_review');
    assert.equal(await remaining(product, date), 3);
    const payload = { order_id: review.id, revision: review.revision, idempotency_key: randomUUID() };
    const paid = await api('approve_payment', payload, ids.owner);
    const retry = await api('approve_payment', payload, ids.owner);
    assert.equal(paid.payment_status, 'paid');
    assert.equal(paid.fulfillment_status, 'confirmed');
    assert.equal(retry.revision, paid.revision);
    assert.equal(await remaining(product, date), 3);
    assert.equal(await h.scalar('select count(*)::int from tlb.payments where order_id=$1', [paid.id]), 1);
    assert.equal((await h.allocations(paid.id))[0].state, 'committed');
    await assert.rejects(action('approve_payment', paid), /review|approved|paid|payment/i);
    assert.equal(await h.scalar('select count(*)::int from tlb.payments where order_id=$1', [paid.id]), 1);
  })();

  await check('late proof is refused and no-proof expiry releases all reserved inventory', async () => {
    const { product, date } = await fixture(2);
    const submitted = await api('create_order', checkout(product, date, { items: [item(product, 2)] }));
    await db.query("update tlb.orders set payment_deadline=clock_timestamp()-interval '1 second' where id=$1", [submitted.id]);
    await assert.rejects(proof(submitted), /expired|deadline|proof|payment/i);
    await db.query('select tlb.expire_orders()');
    const expired = await order(submitted.id);
    assert.equal(expired.fulfillment_status, 'expired');
    assert.equal(expired.payment_status, 'awaiting_payment');
    assert.equal(await remaining(product, date), 2);
    assert.equal((await h.allocations(submitted.id)).length, 0);
  })();

  await check('rejection permanently cancels the order, releases stock and blocks replacement proof', async () => {
    const { product, date } = await fixture(2);
    const submitted = await api('create_order', checkout(product, date, { items: [item(product, 2)] }));
    const review = await proof(submitted);
    const rejected = await action('reject_payment', review, { reason: 'Test receipt rejected' });
    assert.equal(rejected.payment_status, 'rejected');
    assert.equal(rejected.fulfillment_status, 'cancelled');
    assert.equal(await remaining(product, date), 2);
    await assert.rejects(proof(submitted), /cancel|rejected|proof|payment/i);
  })();

  await check('paid quantity edits retain snapshot price, original approved amount and fulfillment progress', async () => {
    const { product, date } = await fixture(10);
    const submitted = await api('create_order', checkout(product, date, { items: [item(product, 2)] }));
    const paid = await action('approve_payment', await proof(submitted));
    const preparing = await action('set_fulfillment', paid, { status: 'preparing' });
    await api('save_product', { product: { ...product, price_cents: 20000 } }, ids.owner);
    const edited = await action('edit_order', preparing, { reason: 'Quantity amendment', changes: { items: [item(product, 3)] } });
    assert.equal(edited.payment_status, 'paid');
    assert.equal(edited.fulfillment_status, 'preparing');
    assert.equal(edited.paid_amount_cents, 20000);
    assert.equal(edited.items[0].unit_price_cents, 10000);
    assert.equal(edited.total_cents, 30000);
    assert.equal(await remaining(product, date), 7);
    assert.equal(await h.scalar('select amount_cents from tlb.payments where order_id=$1', [edited.id]), 20000);
    const unavailableDate = await h.day(31);
    await inventory(product, unavailableDate, 2);
    const before = await order(edited.id);
    const beforeAllocations = await h.allocations(edited.id);
    const beforeEmailCount = await h.scalar('select count(*)::int from tlb.outbox where order_id=$1', [edited.id]);
    await assert.rejects(action('edit_order', edited, { reason: 'Failed date move', changes: { fulfillment_date: unavailableDate } }), /stock|capacity|available|remain/i);
    assert.deepEqual(await order(edited.id), before);
    assert.deepEqual(await h.allocations(edited.id), beforeAllocations);
    assert.equal(await h.scalar('select count(*)::int from tlb.outbox where order_id=$1', [edited.id]), beforeEmailCount);
    assert.equal(await remaining(product, unavailableDate), 2);
    await inventory(product, unavailableDate, 5);
    const moved = await action('edit_order', edited, { reason: 'Successful date move', changes: { fulfillment_date: unavailableDate } });
    assert.equal(moved.fulfillment_status, 'preparing');
    assert.equal(moved.paid_amount_cents, 20000);
    assert.equal(await remaining(product, date), 10);
    assert.equal(await remaining(product, unavailableDate), 2);
  })();

  await check('contact-only edits succeed after a date is disabled; stock cannot shrink below allocations', async () => {
    const { product, date } = await fixture(4);
    const submitted = await api('create_order', checkout(product, date, { items: [item(product, 3)] }));
    await inventory(product, date, 4, false);
    const edited = await action('edit_order', submitted, { reason: 'Contact correction', changes: { buyer: { ...submitted.buyer, phone: '09179999999' } } });
    assert.equal(edited.buyer.phone, '09179999999');
    assert.equal(await remaining(product, date), 1);
    await assert.rejects(inventory(product, date, 2), /allocation|reserved|held|capacity|below/i);
    assert.equal(await remaining(product, date), 1);
  })();

  await check('existing delivery amendments preserve the saved zone fee after deactivation while new destinations remain validated', async () => {
    const { product, date } = await fixture(10);
    const locality = `QA Deactivated ${randomUUID().slice(0, 8)}`;
    const zone = await api('save_zone', { zone: { name: locality, localities: [locality], fee_cents: 2300, active: true } }, ids.owner);
    const payload = checkout(product, date, { method: 'delivery', address: { locality, line1: '123 QA Street' } });
    const submitted = await api('create_order', payload);
    const paid = await action('approve_payment', await proof(submitted));
    await api('save_zone', { zone: { ...zone, active: false } }, ids.owner);
    const edited = await action('edit_order', paid, { reason: 'Existing destination quantity correction', changes: { items: [item(product, 2)] } });
    assert.equal(edited.delivery_cents, 2300);
    assert.equal(edited.total_cents, 22300);
    assert.equal(edited.paid_amount_cents, 12300);
    assert.equal(await remaining(product, date), 8);
    await assert.rejects(api('create_order', { ...payload, idempotency_key: randomUUID() }), /locality|zone|supported/i);
    await assert.rejects(action('edit_order', edited, { reason: 'Unsupported new destination', changes: { address: { ...edited.address, locality: 'Unsupported QA Place' } } }), /locality|zone|supported/i);
    assert.equal((await order(edited.id)).address.locality, locality);
  })();

  await check('method-specific fulfillment and optimistic revisions are enforced', async () => {
    const { product, date } = await fixture();
    const submitted = await api('create_order', checkout(product, date));
    await assert.rejects(action('set_fulfillment', submitted, { status: 'preparing' }), /paid|payment/i);
    const paid = await action('approve_payment', await proof(submitted));
    await assert.rejects(action('set_fulfillment', paid, { status: 'out_for_delivery' }), /pickup|delivery|method|transition|status|progress/i);
    const preparing = await action('set_fulfillment', paid, { status: 'preparing' });
    await assert.rejects(action('set_fulfillment', paid, { status: 'ready_for_pickup' }), /revision|changed|refresh|stale/i);
    assert.equal((await order(preparing.id)).fulfillment_status, 'preparing');
  })();

  await check('cancelling paid produced stock needs explicit restoration and never changes payment', async () => {
    const { product, date } = await fixture(4);
    const first = await api('create_order', checkout(product, date));
    const second = await api('create_order', checkout(product, date));
    const firstPaid = await action('approve_payment', await proof(first));
    const secondPaid = await action('approve_payment', await proof(second));
    const retained = await action('cancel_order', firstPaid, { reason: 'Already produced', restore_stock: false });
    assert.equal(retained.payment_status, 'paid');
    assert.equal(retained.fulfillment_status, 'cancelled');
    assert.equal(await remaining(product, date), 2);
    const restored = await action('cancel_order', secondPaid, { reason: 'Explicit unused stock restoration', restore_stock: true });
    assert.equal(restored.payment_status, 'paid');
    assert.equal(await remaining(product, date), 3);
  })();

  await check('counted options validate exact quantities and only newly selected configurations use current prices', async () => {
    const { product, date } = await fixture(10, { option_groups: [{
      id: 'flavour', label: 'Choose two', required_count: 2,
      choices: [
        { id: 'vanilla', label: 'Vanilla', surcharge_cents: 500, active: true },
        { id: 'chocolate', label: 'Chocolate', surcharge_cents: 1000, active: true },
      ],
    }] });
    await assert.rejects(api('quote', checkout(product, date, { items: [item(product, 1, { flavour: { vanilla: 1 } })] })), /option|choice|select|exact|count|two/i);
    await assert.rejects(api('quote', checkout(product, date, { items: [item(product, 1, { flavour: { nonexistent: 2 } })] })), /option|choice|select|available/i);
    const selection = { flavour: { vanilla: 1, chocolate: 1 } };
    const submitted = await api('create_order', checkout(product, date, { items: [item(product, 2, selection)] }));
    assert.equal(submitted.items[0].unit_price_cents, 11500);
    await api('save_product', { product: { ...product, price_cents: 20000 } }, ids.owner);
    const more = await action('edit_order', submitted, { reason: 'Same selection quantity edit', changes: { items: [item(product, 3, selection)] } });
    assert.equal(more.items[0].unit_price_cents, 11500);
    const changed = await action('edit_order', more, { reason: 'New selection', changes: { items: [item(product, 3, { flavour: { vanilla: 2 } })] } });
    assert.equal(changed.items[0].unit_price_cents, 21000);
    assert.equal(changed.total_cents, 63000);
  })();

  await check('unpaid promo requalification reacquires a slot atomically; paid redemption survives zero discount and cancellation', async () => {
    const { product, date } = await fixture(20);
    const promo = await api('save_promo', { promo: {
      code: `QA${randomUUID().slice(0, 8)}`, kind: 'fixed', value: 1000,
      min_subtotal_cents: 20000, cap_cents: null, per_account_limit: 1, global_limit: 1,
      expires_at: new Date(Date.now() + 86400000).toISOString(), active: true,
    } }, ids.owner);
    const payload = checkout(product, date, { items: [item(product, 2)], promo_code: promo.code });
    await assert.rejects(api('create_order', payload), /account|sign|verif|promo/i);
    await assert.rejects(api('create_order', { ...payload, idempotency_key: randomUUID() }, ids.unverified), /verif|account|promo/i);
    const original = await api('create_order', { ...payload, idempotency_key: randomUUID() }, ids.customer);
    assert.equal(original.discount_cents, 1000);
    assert.equal(await h.scalar('select count(*)::int from tlb.promo_usage where order_id=$1', [original.id]), 1);
    const below = await action('edit_order', original, { reason: 'Below promo minimum', changes: { items: [item(product, 1)] } });
    assert.equal(below.discount_cents, 0);
    assert.equal(await h.scalar('select count(*)::int from tlb.promo_usage where order_id=$1', [original.id]), 0);
    const competitor = await api('create_order', { ...payload, idempotency_key: randomUUID(), buyer: { ...payload.buyer, email: 'stranger@example.test' } }, ids.stranger);
    await assert.rejects(action('edit_order', below, { reason: 'Unavailable promo requalification', changes: { items: [item(product, 2)] } }), /promo|limit|available|redeem|reservation/i);
    assert.equal((await order(below.id)).items[0].quantity, 1);
    await action('cancel_order', competitor, { reason: 'Release promo slot', restore_stock: true });
    const regained = await action('edit_order', below, { reason: 'Available promo requalification', changes: { items: [item(product, 2)] } });
    assert.equal(regained.discount_cents, 1000);
    assert.equal(await h.scalar('select count(*)::int from tlb.promo_usage where order_id=$1', [regained.id]), 1);
    const paid = await action('approve_payment', await proof({ ...regained, access_token: original.access_token }));
    const paidBelow = await action('edit_order', paid, { reason: 'Paid amendment below minimum', changes: { items: [item(product, 1)] } });
    assert.equal(paidBelow.discount_cents, 0);
    assert.equal(paidBelow.paid_amount_cents, 19000);
    assert.equal(await h.scalar('select state from tlb.promo_usage where order_id=$1', [paidBelow.id]), 'redeemed');
    await action('cancel_order', paidBelow, { reason: 'Paid cancellation retains redemption', restore_stock: true });
    assert.equal(await h.scalar('select state from tlb.promo_usage where order_id=$1', [paidBelow.id]), 'redeemed');
  })();

  await check('percentage promo caps are applied to merchandise and never delivery fees', async () => {
    const { product, date } = await fixture();
    const promo = await api('save_promo', { promo: {
      code: `QA${randomUUID().slice(0, 8)}`, kind: 'percent', value: 25,
      min_subtotal_cents: 0, cap_cents: 3000, per_account_limit: 2, global_limit: 10,
      expires_at: new Date(Date.now() + 86400000).toISOString(), active: true,
    } }, ids.owner);
    const quote = await api('quote', checkout(product, date, {
      items: [item(product, 2)], promo_code: promo.code, method: 'delivery',
      address: { locality: 'QA City / QA Barangay', line1: '123 QA Street' },
    }), ids.customer);
    assert.equal(quote.subtotal_cents, 20000);
    assert.equal(quote.discount_cents, 3000);
    assert.equal(quote.delivery_cents, 1500);
    assert.equal(quote.total_cents, 18500);
    assert.equal(await h.scalar('select count(*)::int from tlb.promo_usage where promo_id=$1', [promo.id]), 0);
  })();

  await check('a promo first requalified after below-minimum payment acquires one redeemed slot', async () => {
    const { product, date } = await fixture(20);
    const promo = await api('save_promo', { promo: {
      code: `QA${randomUUID().slice(0, 8)}`, kind: 'fixed', value: 1000,
      min_subtotal_cents: 20000, cap_cents: null, per_account_limit: 1, global_limit: 1,
      expires_at: new Date(Date.now() + 86400000).toISOString(), active: true,
    } }, ids.owner);
    const payload = checkout(product, date, { items: [item(product, 2)], promo_code: promo.code });
    const original = await api('create_order', payload, ids.customer);
    const below = await action('edit_order', original, { reason: 'Release before approval', changes: { items: [item(product, 1)] } });
    const paid = await action('approve_payment', await proof({ ...below, access_token: original.access_token }));
    assert.equal(paid.discount_cents, 0);
    assert.equal(await h.scalar('select count(*)::int from tlb.promo_usage where order_id=$1', [paid.id]), 0);
    const requalified = await action('edit_order', paid, { reason: 'First paid requalification', changes: { items: [item(product, 2)] } });
    assert.equal(requalified.discount_cents, 1000);
    assert.equal(requalified.paid_amount_cents, 10000);
    assert.equal(await h.scalar('select state from tlb.promo_usage where order_id=$1', [paid.id]), 'redeemed');
    await assert.rejects(api('create_order', { ...payload, idempotency_key: randomUUID() }, ids.stranger), /promo|limit/i);
    assert.equal(await h.scalar('select count(*)::int from tlb.promo_usage where promo_id=$1', [promo.id]), 1);
  })();

  await check('private tables, service RPC and owner operations reject customer access', async () => {
    await assert.rejects(h.as(ids.customer, () => db.query('select * from tlb.orders')), /permission denied/i);
    await assert.rejects(h.as(null, () => db.query("select public.shop_service('authorize_upload', '{}'::jsonb)")), /permission denied|service/i);
    await assert.rejects(api('admin_bootstrap', {}, ids.customer), /authorized|staff|access/i);
    await assert.rejects(api('save_settings', { settings: initial.settings }, ids.staff), /owner|access/i);
    await assert.rejects(api('save_staff', { email: 'owner@example.test', role: 'none' }, ids.owner), /final|last|owner/i);
  })();

  await check('closed and completed orders accept audited contact corrections while preserving financial and stock facts', async () => {
    const { product, date } = await fixture(5);
    for (const terminal of ['cancelled', 'completed']) {
      const submitted = await api('create_order', checkout(product, date));
      const paid = await action('approve_payment', await proof(submitted));
      const closed = terminal === 'cancelled'
        ? await action('cancel_order', paid, { reason: 'Test closure', restore_stock: false })
        : await action('set_fulfillment', paid, { status: 'completed' });
      const beforeAllocations = await h.allocations(closed.id);
      const edited = await action('edit_order', closed, { reason: 'Correct archived contact', changes: { buyer: { ...closed.buyer, phone: '09173333333' } } });
      assert.equal(edited.buyer.phone, '09173333333');
      assert.equal(edited.payment_status, 'paid');
      assert.equal(edited.fulfillment_status, terminal);
      assert.equal(edited.paid_amount_cents, closed.paid_amount_cents);
      assert.equal(edited.total_cents, closed.total_cents);
      assert.deepEqual(await h.allocations(closed.id), beforeAllocations);
      assert.equal(edited.history.at(-1).reason, 'Correct archived contact');
      await assert.rejects(action('edit_order', edited, { reason: 'Forbidden closed quantity edit', changes: { items: [item(product, 2)] } }), /closed|cancel|complete|stock|financial|amend|contact/i);
      assert.deepEqual(await h.allocations(closed.id), beforeAllocations);
    }
  })();
}
