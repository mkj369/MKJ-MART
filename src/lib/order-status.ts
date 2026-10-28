/** Order & payment state machine shared by the server (enforcement) and UI (labels, timelines). */

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['cod', 'sslcommerz'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['unpaid', 'pending', 'paid', 'failed', 'cancelled', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Placed',
  confirmed: 'Confirmed',
  processing: 'Packing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

export const ORDER_STATUS_DESCRIPTION: Record<OrderStatus, string> = {
  pending: 'We have received your order and will confirm it shortly.',
  confirmed: 'Your order is confirmed and queued for packing.',
  processing: 'Your items are being quality-checked and packed.',
  shipped: 'Your parcel is with our delivery partner.',
  delivered: 'Your parcel has been delivered.',
  cancelled: 'This order has been cancelled.',
  returned: 'This order was returned.',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cod: 'Cash on Delivery',
  sslcommerz: 'Online payment (SSLCommerz)',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  pending: 'Awaiting payment',
  paid: 'Paid',
  failed: 'Payment failed',
  cancelled: 'Payment cancelled',
  refunded: 'Refunded',
};

/** The happy-path fulfilment steps rendered as a progress timeline. */
export const FULFILMENT_STEPS: OrderStatus[] = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];

/** Allowed admin transitions. Anything not listed is rejected by the server. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Online-paid orders must not move forward in fulfilment until the payment is confirmed by the
 * gateway. They can only be cancelled while payment is outstanding.
 */
export function transitionBlockedByPayment(
  method: PaymentMethod,
  paymentStatus: PaymentStatus,
  to: OrderStatus,
): boolean {
  return method !== 'cod' && paymentStatus !== 'paid' && to !== 'cancelled';
}

export function isOrderOpen(status: OrderStatus): boolean {
  return status !== 'cancelled' && status !== 'returned' && status !== 'delivered';
}
