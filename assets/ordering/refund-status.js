// Refunds are recorded separately so the original payment and fulfillment history stay intact.
export function fulfillmentStatus(order) {
  return order.refund_label ? 'refunded' : order.fulfillment_status;
}

export function matchesFulfillmentStatus(order, selected) {
  return !selected || fulfillmentStatus(order) === selected;
}

const INACTIVE = new Set(['cancelled', 'expired', 'completed', 'refunded']);

export function isActiveFulfillment(order) {
  return !INACTIVE.has(fulfillmentStatus(order));
}

export function needsPaymentReview(order) {
  return order.payment_status === 'under_review'
    && order.fulfillment_status === 'pending_confirmation'
    && !order.refund_label;
}
