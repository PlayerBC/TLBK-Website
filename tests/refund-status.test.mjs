import test from 'node:test';
import assert from 'node:assert/strict';
import { fulfillmentStatus, matchesFulfillmentStatus, isActiveFulfillment, needsPaymentReview } from '../assets/ordering/refund-status.js';
import { buildAnalytics } from '../assets/ordering/analytics.js';

const paidOrder = overrides => ({
  id: 'paid-order', created_at: '2026-09-18T02:00:00Z', fulfillment_date: '2026-09-19',
  payment_status: 'paid', fulfillment_status: 'confirmed', refund_label: false,
  method: 'pickup', paid_amount_cents: 20000, total_cents: 20000, subtotal_cents: 20000,
  discount_cents: 0, delivery_cents: 0,
  items: [{ product_id: 'nori', name: 'Nori chips', quantity: 2, unit_price_cents: 10000, line_total_cents: 20000 }],
  ...overrides,
});

test('only active, unrefunded payment reviews appear in the review queue', () => {
  const review = paidOrder({ payment_status: 'under_review', fulfillment_status: 'pending_confirmation' });
  assert.equal(needsPaymentReview(review), true);
  for (const status of ['cancelled', 'expired', 'completed', 'confirmed']) {
    assert.equal(needsPaymentReview({ ...review, fulfillment_status: status }), false);
  }
  assert.equal(needsPaymentReview({ ...review, refund_label: true }), false);
  for (const payment_status of ['awaiting_payment', 'paid', 'rejected', 'cancelled']) {
    assert.equal(needsPaymentReview({ ...review, payment_status }), false);
  }
});

test('refund display preserves original progress and payment, and removing the label restores them', () => {
  for (const status of ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled', 'expired']) {
    const order = paidOrder({ fulfillment_status: status, refund_label: true });
    const snapshot = structuredClone(order);
    assert.equal(fulfillmentStatus(order), 'refunded');
    assert.equal(isActiveFulfillment(order), false);
    assert.deepEqual(order, snapshot, 'presentation must not overwrite stored state or payment');
    const restored = { ...order, refund_label: false };
    assert.equal(fulfillmentStatus(restored), status);
    assert.equal(restored.payment_status, 'paid');
    assert.equal(restored.paid_amount_cents, 20000);
  }
});

test('fulfillment filters classify each visible status once and keep refunded orders out of active work', () => {
  const orders = [
    paidOrder({ id: 'confirmed' }),
    paidOrder({ id: 'refunded-confirmed', refund_label: true }),
    paidOrder({ id: 'cancelled', fulfillment_status: 'cancelled' }),
    paidOrder({ id: 'refunded-cancelled', fulfillment_status: 'cancelled', refund_label: true }),
    paidOrder({ id: 'completed', fulfillment_status: 'completed' }),
    paidOrder({ id: 'pending', payment_status: 'awaiting_payment', fulfillment_status: 'pending_confirmation' }),
  ];
  const matching = status => orders.filter(order => matchesFulfillmentStatus(order, status)).map(order => order.id);
  assert.deepEqual(matching(''), orders.map(order => order.id));
  assert.deepEqual(matching('refunded'), ['refunded-confirmed', 'refunded-cancelled']);
  assert.deepEqual(matching('confirmed'), ['confirmed']);
  assert.deepEqual(matching('cancelled'), ['cancelled']);
  assert.deepEqual(orders.filter(isActiveFulfillment).map(order => order.id), ['confirmed', 'pending']);
  for (const order of orders) {
    assert.equal(['confirmed', 'cancelled', 'refunded', 'completed', 'pending_confirmation']
      .filter(status => matchesFulfillmentStatus(order, status)).length, 1);
  }
});

test('displaying a refund keeps sales deductions and original payment totals consistent', () => {
  const order = paidOrder({ refund_label: true });
  const report = () => buildAnalytics([order], { today: '2026-09-18' });
  const before = report();
  assert.equal(fulfillmentStatus(order), 'refunded');
  assert.equal(matchesFulfillmentStatus(order, 'refunded'), true);
  assert.deepEqual(report(), before);
  assert.equal(before.currentOrderValueCents, 0);
  assert.equal(before.approvedPaymentsCents, 20000);
  assert.equal(before.pickupCount, 0);
  assert.equal(before.refundedPaidOrderCount, 1);
  order.refund_label = false;
  assert.equal(fulfillmentStatus(order), 'confirmed');
  assert.equal(report().currentOrderValueCents, 20000);
  assert.equal(report().pickupCount, 1);
});
