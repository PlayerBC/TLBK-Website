import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsDateRange, buildAnalytics, manilaOrderDate} from '../assets/ordering/analytics.js';

const today = '2026-09-16';
const item = (overrides = {}) => ({product_id: 'nori', name: 'Nori', quantity: 2, unit_price_cents: 13000, line_total_cents: 26000, ...overrides});
const order = (overrides = {}) => ({id: 'one', created_at: '2026-09-16T01:00:00Z', payment_status: 'paid', fulfillment_status: 'confirmed', method: 'pickup', paid_amount_cents: 26000, total_cents: 26000, subtotal_cents: 26000, discount_cents: 0, delivery_cents: 0, items: [item()], ...overrides});

test('customers, repeat buyers and completed orders use paid sales and normalized buyer emails', () => {
  const rows = [
    order({id: 'one', buyer: {email: ' Buyer@Example.TEST '}, fulfillment_status: 'completed'}),
    order({id: 'two', buyer: {email: 'buyer@example.test'}, fulfillment_status: 'completed'}),
    order({id: 'three', buyer: {email: 'other@example.test'}, fulfillment_status: 'preparing'}),
    ...['cancelled', 'expired'].map(fulfillment_status => order({buyer: {email: 'closed@example.test'}, fulfillment_status})),
    order({buyer: {email: 'refunded@example.test'}, fulfillment_status: 'completed', refund_label: true}),
    order({buyer: {email: 'unpaid@example.test'}, payment_status: 'under_review', fulfillment_status: 'pending_confirmation'}),
  ];
  const before = structuredClone(rows);
  const a = buildAnalytics(rows, {today});
  assert.equal(a.customerCount, 2);
  assert.equal(a.repeatCustomerCount, 1);
  assert.equal(a.completedOrderCount, 2);
  assert.equal(a.toFulfillCount, 1);
  assert.equal(a.completedOrderCount + a.toFulfillCount, a.activePaidOrderCount);
  assert.deepEqual(rows, before);
  assert.doesNotMatch(JSON.stringify(a), /buyer@example|other@example|unpaid@example/i);
});

test('repeat-customer and completion counts follow Manila placement dates in the selected period', () => {
  const rows = [
    order({id: 'before', created_at: '2026-09-15T15:59:59Z', buyer: {email: 'same@example.test'}, fulfillment_status: 'completed'}),
    order({id: 'inside', created_at: '2026-09-15T16:00:00Z', buyer: {email: 'SAME@example.test'}, fulfillment_status: 'completed'}),
  ];
  const filtered = buildAnalytics(rows, {today, start: today, end: today});
  assert.equal(filtered.customerCount, 1);
  assert.equal(filtered.repeatCustomerCount, 0);
  assert.equal(filtered.completedOrderCount, 1);
  assert.equal(buildAnalytics(rows, {today}).repeatCustomerCount, 1);
});

test('promo use counts discounted paid orders once and groups saved codes without current catalog data', () => {
  const promo = (id, code, discount_cents, extra = {}) => order({id, discount_cents, promo_snapshot: {code}, ...extra});
  const a = buildAnalytics([
    promo('one', ' save10 ', 1000), promo('two', 'SAVE10', 500), promo('three', 'OLD-CODE', 2000),
    promo('zero', 'SAVE10', 0), promo('no-code', '', 1000),
    promo('cancelled', 'SAVE10', 1000, {fulfillment_status: 'cancelled'}),
    promo('expired', 'SAVE10', 1000, {fulfillment_status: 'expired'}),
    promo('refund', 'SAVE10', 1000, {refund_label: true}),
    promo('unpaid', 'SAVE10', 1000, {payment_status: 'under_review'}),
    promo('outside', 'SAVE10', 1000, {created_at: '2026-09-14T01:00:00Z'}),
  ], {today, start: today, end: today});
  assert.equal(a.promoUseCount, 3);
  assert.equal(a.distinctPromoCodeCount, 2);
  assert.deepEqual(a.promoCodes, [
    {code: 'SAVE10', orderCount: 2, discountCents: 1500},
    {code: 'OLD-CODE', orderCount: 1, discountCents: 2000},
  ]);
});

test('saved edits and refund changes update customer, completion and promo counts consistently', () => {
  const paid = order({buyer: {email: 'buyer@example.test'}, fulfillment_status: 'completed', promo_snapshot: {code: 'SAVE10'}, discount_cents: 1000});
  const summarize = changes => buildAnalytics([{...paid, ...changes}], {today});
  for (const changes of [{refund_label: true}, {fulfillment_status: 'cancelled'}]) {
    const a = summarize(changes);
    assert.equal(a.customerCount, 0);
    assert.equal(a.completedOrderCount, 0);
    assert.equal(a.promoUseCount, 0);
  }
  assert.equal(summarize({refund_label: false}).customerCount, 1);
  assert.equal(summarize({refund_label: false}).completedOrderCount, 1);
  assert.equal(summarize({refund_label: false}).promoUseCount, 1);
  assert.equal(summarize({discount_cents: 0}).promoUseCount, 0);
});

test('missing buyer emails are not merged into an invented customer and invalid ranges stay empty', () => {
  const rows = [order(), order({buyer: {email: '  '}}), order({buyer: {email: null}})];
  const a = buildAnalytics(rows, {today});
  assert.equal(a.customerCount, 0);
  assert.equal(a.repeatCustomerCount, 0);
  assert.equal(a.toFulfillCount, 3);
  for (const empty of [buildAnalytics([], {today}), buildAnalytics(rows, {today, start: 'invalid'})]) {
    for (const field of ['customerCount', 'repeatCustomerCount', 'completedOrderCount', 'promoUseCount', 'distinctPromoCodeCount']) assert.equal(empty[field], 0);
    assert.deepEqual(empty.promoCodes, []);
  }
});

test('date presets include today and cross month and leap-year boundaries', () => {
  assert.deepEqual(analyticsDateRange('today', today), {start: today, end: today});
  assert.deepEqual(analyticsDateRange('last7', '2026-03-02'), {start: '2026-02-24', end: '2026-03-02'});
  assert.deepEqual(analyticsDateRange('last30', '2024-03-01'), {start: '2024-02-01', end: '2024-03-01'});
  assert.deepEqual(analyticsDateRange('this_month', today), {start: '2026-09-01', end: today});
  for (const preset of ['all', 'custom']) assert.deepEqual(analyticsDateRange(preset, today), {start: '', end: ''});
});

test('Manila midnight boundaries determine placement dates, not fulfillment dates', () => {
  assert.equal(manilaOrderDate('2026-09-15T15:59:59.999Z'), '2026-09-15');
  assert.equal(manilaOrderDate('2026-09-15T16:00:00Z'), today);
  const a = buildAnalytics([
    order({created_at: '2026-09-15T15:59:59.999Z', fulfillment_date: today}),
    order({created_at: '2026-09-15T16:00:00Z', fulfillment_date: '2026-09-22'}),
    order({created_at: '2026-09-16T15:59:59.999Z'}),
    order({created_at: '2026-09-16T16:00:00Z'})
  ], {start: today, end: today, today});
  assert.equal(a.totalOrders, 2);
  assert.equal(a.currentOrderValueCents, 52000);
  assert.equal(a.trend[0].orderCount, 2);
});

test('paid edits immediately change sales and products while preserving original approvals', () => {
  const initial = order();
  const options = {today, start: today, end: today};
  assert.equal(buildAnalytics([initial], options).currentOrderValueCents, 26000);
  const edited = order({total_cents: 47000, subtotal_cents: 39000, discount_cents: 2000, delivery_cents: 10000,
    items: [item({quantity: 3, line_total_cents: 39000})], method: 'delivery'});
  const a = buildAnalytics([edited], options);
  assert.equal(a.currentOrderValueCents, 47000);
  assert.equal(a.averageOrderValueCents, 47000);
  assert.equal(a.approvedPaymentsCents, 26000);
  assert.equal(a.averageApprovedPaymentCents, 26000);
  assert.equal(a.currentProductValueCents, 39000);
  assert.equal(a.currentDiscountCents, 2000);
  assert.equal(a.currentDeliveryCents, 10000);
  assert.equal(a.additionalPaymentCents, 21000);
  assert.equal(a.refundDifferenceCents, 0);
  assert.equal(a.paidAdjustmentCount, 1);
  assert.equal(a.totalUnits, 3);
  assert.equal(a.trend[0].currentOrderValueCents, 47000);
  assert.equal(a.trend[0].approvedPaymentsCents, 26000);
});

test('cancelled orders with a full-refund label are excluded only once', () => {
  const a = buildAnalytics([order({fulfillment_status: 'cancelled', refund_label: true})], {today});
  assert.equal(a.totalOrders, 1);
  assert.equal(a.cancelledCount, 1);
  assert.equal(a.paidOrderCount, 1);
  assert.equal(a.approvedPaymentsCents, 26000);
  assert.equal(a.currentOrderValueCents, 0);
  assert.equal(a.averageOrderValueCents, null);
  assert.equal(a.refundFlaggedCount, 1);
  assert.equal(a.refundedPaidOrderCount, 1);
  assert.equal(a.fullRefundOrderValueCents, 26000);
  assert.equal(a.refundDifferenceCents, 0);
  assert.equal(a.totalUnits, 0);
  assert.deepEqual(a.topProducts, []);
});

test('a full-refund label removes completed paid orders from sales and all derived metrics', () => {
  const a = buildAnalytics([order({fulfillment_status: 'completed', refund_label: true})], {today});
  assert.equal(a.currentOrderValueCents, 0);
  assert.equal(a.activePaidOrderCount, 0);
  assert.equal(a.averageOrderValueCents, null);
  assert.equal(a.approvedPaymentsCents, 26000);
  assert.equal(a.totalUnits, 0);
  assert.equal(a.refundFlaggedCount, 1);
  assert.equal(a.fullRefundOrderValueCents, 26000);
  assert.equal(a.pickupCount, 0);
  assert.deepEqual(a.topProducts, []);
  assert.equal(a.trend.reduce((sum, bucket) => sum + bucket.currentOrderValueCents, 0), 0);
});

test('active unpaid statuses are separate from expired and rejected reservations', () => {
  const a = buildAnalytics([
    order({payment_status: 'awaiting_payment', paid_amount_cents: null, fulfillment_status: 'pending_confirmation'}),
    order({payment_status: 'under_review', paid_amount_cents: null, fulfillment_status: 'pending_confirmation', method: 'delivery'}),
    order({payment_status: 'awaiting_payment', paid_amount_cents: null, fulfillment_status: 'expired'}),
    order({payment_status: 'rejected', paid_amount_cents: null, fulfillment_status: 'cancelled', method: 'delivery'})
  ], {today});
  assert.equal(a.totalOrders, 4);
  assert.equal(a.awaitingPaymentCount, 1);
  assert.equal(a.underReviewCount, 1);
  assert.equal(a.expiredCount, 1);
  assert.equal(a.cancelledCount, 1);
  assert.equal(a.pickupCount, 0);
  assert.equal(a.deliveryCount, 0);
  assert.equal(a.currentOrderValueCents, 0);
  assert.equal(a.approvedPaymentsCents, 0);
  assert.equal(a.totalUnits, 0);
});

test('full refund excludes the latest edited total with delivery and discount; removing label restores it', () => {
  const edited = order({total_cents: 47000, subtotal_cents: 39000, discount_cents: 2000, delivery_cents: 10000,
    items: [item({quantity: 3, line_total_cents: 39000})], method: 'delivery', refund_label: true});
  const refunded = buildAnalytics([edited], {today});
  assert.equal(refunded.fullRefundOrderValueCents, 47000);
  assert.equal(refunded.approvedPaymentsCents, 26000);
  assert.equal(refunded.currentOrderValueCents, 0);
  assert.equal(refunded.currentProductValueCents, 0);
  assert.equal(refunded.currentDiscountCents, 0);
  assert.equal(refunded.currentDeliveryCents, 0);
  assert.equal(refunded.additionalPaymentCents, 0);
  assert.equal(refunded.deliveryCount, 0);
  const restored = buildAnalytics([{...edited, refund_label: false}], {today});
  assert.equal(restored.currentOrderValueCents, 47000);
  assert.equal(restored.averageOrderValueCents, 47000);
  assert.equal(restored.fullRefundOrderValueCents, 0);
  assert.equal(restored.totalUnits, 3);
  assert.equal(restored.deliveryCount, 1);
  assert.equal(restored.currentProductValueCents - restored.currentDiscountCents + restored.currentDeliveryCents, 47000);
  assert.equal(buildAnalytics([{...edited, refund_label: false, fulfillment_status: 'cancelled'}], {today}).currentOrderValueCents, 0);
});

test('pickup and delivery count only kept paid orders, including completed orders', () => {
  const a = buildAnalytics([
    order(), order({method: 'delivery', fulfillment_status: 'completed'}),
    order({method: 'delivery', payment_status: 'under_review', paid_amount_cents: null}),
    order({method: 'pickup', payment_status: 'awaiting_payment', paid_amount_cents: null}),
    order({method: 'delivery', fulfillment_status: 'cancelled'}),
    order({method: 'delivery', fulfillment_status: 'expired'}),
    order({method: 'delivery', refund_label: true})
  ], {today});
  assert.equal(a.totalOrders, 7);
  assert.equal(a.pickupCount, 1);
  assert.equal(a.deliveryCount, 1);
  assert.equal(a.activePaidOrderCount, 2);
  assert.equal(a.currentOrderValueCents, 52000);
  assert.equal(a.averageOrderValueCents, 26000);
});

test('refunded cancellations never reduce other orders or invent negative sales', () => {
  const a = buildAnalytics([order(), order({total_cents: 100000, fulfillment_status: 'cancelled', refund_label: true})], {today});
  assert.equal(a.currentOrderValueCents, 26000);
  assert.equal(a.fullRefundOrderValueCents, 100000);
  assert.equal(a.averageOrderValueCents, 26000);
  assert.equal(a.totalUnits, 2);
});

test('an unpaid refund label is counted but creates no refund money or negative sale', () => {
  const a = buildAnalytics([order({refund_label: true, payment_status: 'awaiting_payment', paid_amount_cents: null})], {today});
  assert.equal(a.totalOrders, 1);
  assert.equal(a.refundFlaggedCount, 1);
  assert.equal(a.refundedPaidOrderCount, 0);
  assert.equal(a.fullRefundOrderValueCents, 0);
  assert.equal(a.currentOrderValueCents, 0);
});

test('refunds revise the placement-date period and need no original payment amount', () => {
  const refunded = order({created_at: '2026-09-15T01:00:00Z', refund_label: true, paid_amount_cents: null});
  const outside = buildAnalytics([refunded], {today, start: today, end: today});
  assert.equal(outside.fullRefundOrderValueCents, 0);
  assert.equal(outside.refundedPaidOrderCount, 0);
  const inside = buildAnalytics([refunded], {today, start: '2026-09-15', end: '2026-09-15'});
  assert.equal(inside.fullRefundOrderValueCents, 26000);
  assert.equal(inside.currentOrderValueCents, 0);
  assert.equal(inside.missingApprovedAmountCount, 1);
});

test('missing approval amounts are surfaced without substituting edited order totals', () => {
  const a = buildAnalytics([order({paid_amount_cents: null}), order({paid_amount_cents: undefined}), order({paid_amount_cents: 0}), order()], {today});
  assert.equal(a.paidOrderCount, 4);
  assert.equal(a.missingApprovedAmountCount, 2);
  assert.equal(a.approvedAmountOrderCount, 2);
  assert.equal(a.approvedPaymentsCents, 26000);
  assert.equal(a.averageApprovedPaymentCents, 13000);
  assert.equal(a.currentOrderValueCents, 104000);
});

test('positive and negative order adjustments remain separate across customers', () => {
  const a = buildAnalytics([order({total_cents: 36000}), order({total_cents: 16000})], {today});
  assert.equal(a.additionalPaymentCents, 10000);
  assert.equal(a.refundDifferenceCents, 10000);
  assert.equal(a.paidAdjustmentCount, 2);
  assert.equal(a.averageOrderValueCents, 26000);
});

test('top products aggregate flavor lines by product ID and count each order once', () => {
  const a = buildAnalytics([
    order({items: [item({quantity: 1, line_total_cents: 13000, name: 'Old name', selections: {flavor: 'original'}}), item({quantity: 2, line_total_cents: 26000, name: 'New name', selections: {flavor: 'bbq'}})]}),
    order({id: 'two', items: [item({quantity: 1, line_total_cents: 13000})]}),
    order({id: 'three', items: [item({product_id: 'cake', name: 'Nori', quantity: 4, line_total_cents: 80000})]}),
    order({fulfillment_status: 'expired', items: [item({quantity: 100, line_total_cents: 1300000})]})
  ], {today, products: [{id: 'nori', name: 'Krisp Nori Pouch'}]});
  assert.deepEqual(a.topProducts, [
    {productId: 'cake', name: 'Nori', units: 4, lineValueCents: 80000, orderCount: 1},
    {productId: 'nori', name: 'Krisp Nori Pouch', units: 4, lineValueCents: 52000, orderCount: 2}
  ]);
  assert.equal(a.totalUnits, 8);
});

test('deleted products retain snapshot names and missing line totals use saved unit prices', () => {
  const a = buildAnalytics([order({items: [item({name: 'Discontinued pouch', line_total_cents: undefined})]})], {today, products: []});
  assert.equal(a.topProducts[0].name, 'Discontinued pouch');
  assert.equal(a.topProducts[0].lineValueCents, 26000);
});

test('malformed and negative values never produce negative or NaN reports', () => {
  const a = buildAnalytics([
    order({paid_amount_cents: -5, total_cents: -1, subtotal_cents: Infinity, discount_cents: 'no', delivery_cents: -9,
      items: [item({quantity: -2}), item({quantity: 1.5}), item({quantity: 1, line_total_cents: -5}), null]}),
    order({paid_amount_cents: '26000', total_cents: '26000', items: []})
  ], {today});
  assert.equal(a.missingApprovedAmountCount, 1);
  assert.equal(a.approvedPaymentsCents, 26000);
  assert.equal(a.currentOrderValueCents, 26000);
  assert.equal(a.totalUnits, 1);
  assert.equal(a.topProducts[0].lineValueCents, 0);
  for (const value of Object.values(a)) if (typeof value === 'number') assert.ok(Number.isFinite(value) && value >= 0);
});

test('empty reports are meaningful and invalid dates or reversed filters are safe', () => {
  const empty = buildAnalytics([], {start: '2026-09-10', end: today, today});
  assert.equal(empty.totalOrders, 0);
  assert.equal(empty.averageOrderValueCents, null);
  assert.equal(empty.trend.length, 7);
  assert.ok(empty.trend.every(bucket => bucket.currentOrderValueCents === 0));
  assert.equal(buildAnalytics([order({created_at: 'invalid'})], {today}).invalidDateOrderCount, 1);
  assert.equal(manilaOrderDate('2026-02-30'), '');
  assert.equal(manilaOrderDate(null), '');
  for (const range of [{start: '2026-09-17', end: today}, {start: '2026-02-30', end: today}]) {
    const a = buildAnalytics([order()], {...range, today});
    assert.equal(a.invalidRange, true);
    assert.equal(a.totalOrders, 0);
    assert.deepEqual(a.trend, []);
  }
});

test('trends stay within 31 bars for daily, weekly and multi-year reports and preserve totals', () => {
  for (const [start, end, unit] of [
    ['2026-09-01', '2026-09-30', 'day'],
    ['2026-06-01', '2026-09-30', 'week'],
    ['2025-01-01', '2026-09-30', 'month'],
    ['2010-01-01', '2026-09-30', 'month']
  ]) {
    const a = buildAnalytics([order(), order({fulfillment_status: 'cancelled'})], {start, end, today});
    assert.equal(a.trendUnit, unit);
    assert.ok(a.trend.length <= 31);
    assert.equal(a.trend[0].start, start);
    assert.equal(a.trend.at(-1).end, end);
    assert.equal(a.trend.reduce((sum, bucket) => sum + bucket.orderCount, 0), 2);
    assert.equal(a.trend.reduce((sum, bucket) => sum + bucket.approvedPaymentsCents, 0), 52000);
    assert.equal(a.trend.reduce((sum, bucket) => sum + bucket.currentOrderValueCents, 0), 26000);
  }
});

test('report building does not mutate orders, product snapshots or products', () => {
  const rows = [order()];
  const products = [{id: 'nori', name: 'Nori renamed'}];
  const before = JSON.stringify({rows, products});
  buildAnalytics(rows, {today, products});
  assert.equal(JSON.stringify({rows, products}), before);
});
