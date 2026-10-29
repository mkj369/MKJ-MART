/** Return / refund workflow shared by the server (enforcement) and UI (labels). */

export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Approved — awaiting parcel',
  rejected: 'Declined',
  received: 'Received — inspecting',
  refunded: 'Refunded',
  cancelled: 'Withdrawn',
};

export const RETURN_STATUS_DESCRIPTION: Record<ReturnStatus, string> = {
  requested: 'We have your request and will review it within one working day.',
  approved: 'Your return is approved. Please send the items back as described below.',
  rejected: 'This return request was declined.',
  received: 'We have received the items and are inspecting them.',
  refunded: 'Your refund has been issued.',
  cancelled: 'This return request was withdrawn.',
};

/** Allowed admin transitions. "refunded" is reached by recording a refund, not directly. */
export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['received', 'rejected'],
  received: [],
  rejected: [],
  refunded: [],
  cancelled: [],
};

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from].includes(to);
}

/** Requests that still "hold" items (they count against the quantity that may be returned). */
export const ACTIVE_RETURN_STATUSES: ReturnStatus[] = ['requested', 'approved', 'received', 'refunded'];

export const RETURN_REASONS = ['size_fit', 'damaged', 'wrong_item', 'not_as_described', 'quality', 'changed_mind', 'other'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  size_fit: 'Size or fit is not right',
  damaged: 'Arrived damaged or defective',
  wrong_item: 'Received the wrong item',
  not_as_described: 'Not as described or pictured',
  quality: 'Quality not as expected',
  changed_mind: 'Changed my mind',
  other: 'Other',
};

/**
 * How a refund was paid OUTSIDE the platform. MKJ MART only records refunds; it never moves money.
 * For online payments, refunds are issued from the SSLCommerz merchant panel.
 */
export const REFUND_METHODS = ['sslcommerz_panel', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'cash', 'other'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  sslcommerz_panel: 'SSLCommerz merchant panel',
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  other: 'Other',
};

export type ReturnEligibility = {
  eligible: boolean;
  /** Why a return cannot be requested (null when eligible, or when returns simply do not apply yet). */
  reason: string | null;
  deadline: Date | null;
  /** Quantity per order item that may still be returned. */
  remaining: Record<string, number>;
};

/** Pure rule set for "can this order be returned online?" — shared by the API and the order page. */
export function computeReturnEligibility(input: {
  status: string;
  deliveredAt: Date | null;
  items: { id: string; quantity: number }[];
  returns: { status: ReturnStatus; items: { orderItemId: string; quantity: number }[] }[];
  settings: { enabled: boolean; windowDays: number };
  now?: Date;
}): ReturnEligibility {
  const now = input.now ?? new Date();
  const held = new Map<string, number>();
  for (const r of input.returns) {
    if (!ACTIVE_RETURN_STATUSES.includes(r.status)) continue;
    for (const item of r.items) held.set(item.orderItemId, (held.get(item.orderItemId) ?? 0) + item.quantity);
  }
  const remaining = Object.fromEntries(input.items.map((i) => [i.id, Math.max(0, i.quantity - (held.get(i.id) ?? 0))]));
  const deadline = input.deliveredAt ? new Date(input.deliveredAt.getTime() + input.settings.windowDays * 86_400_000) : null;
  const deny = (reason: string | null): ReturnEligibility => ({ eligible: false, reason, deadline, remaining });

  if (input.status !== 'delivered' || !input.deliveredAt) return deny(null);
  if (!input.settings.enabled) return deny('Online return requests are not available. Please contact customer care.');
  if (deadline && now > deadline) return deny('The return window for this order has closed.');
  if (input.returns.some((r) => r.status === 'requested' || r.status === 'approved')) {
    return deny('You already have a return request in progress for this order.');
  }
  if (Object.values(remaining).every((q) => q === 0)) return deny('All items from this order have already been returned.');
  return { eligible: true, reason: null, deadline, remaining };
}
