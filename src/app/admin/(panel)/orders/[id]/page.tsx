import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Alert, Badge } from '@/components/ui/feedback';
import { OrderStatusBadge, PageHeader, Panel, PaymentStatusBadge } from '@/components/admin/ui';
import { AdminNoteEditor, OrderWorkflow, ReconcileButton, RefundPanel, ShippingEditor } from '@/components/admin/order-actions';
import { requireAdminPage } from '@/server/auth/current-user';
import { sslcommerzConfig } from '@/server/env';
import { getOrderAdmin } from '@/server/services/admin/orders';
import { formatBDT } from '@/lib/money';
import { ORDER_TRANSITIONS, PAYMENT_METHOD_LABEL, transitionBlockedByPayment } from '@/lib/order-status';
import { can } from '@/lib/permissions';
import { REFUND_METHOD_LABEL, RETURN_STATUS_LABEL, type RefundMethod } from '@/lib/returns';
import { formatBdPhone } from '@/lib/phone';
import { cn, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Order' };

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminPage('orders:manage', `/admin/orders/${id}`);
  const { order, items, events, transactions, customer, notifications, returns, refunds, riskFlagged } = await getOrderAdmin(id);
  const refundable = order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded' ? order.total - order.refundedTotal : 0;
  const gatewayConfigured = !!sslcommerzConfig();
  const transitions = ORDER_TRANSITIONS[order.status].map((to) => ({
    to,
    blocked: transitionBlockedByPayment(order.paymentMethod, order.paymentStatus, to),
  }));

  return (
    <>
      <PageHeader
        back={{ href: '/admin/orders', label: 'Orders' }}
        title={<span className="flex flex-wrap items-center gap-3">{order.orderNumber} {order.isDemo ? <Badge tone="gold">Demo</Badge> : null}</span>}
        description={`Placed ${formatDateTime(order.placedAt)} · ${PAYMENT_METHOD_LABEL[order.paymentMethod]}`}
        actions={
          <>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
          </>
        }
      />

      {riskFlagged ? (
        <Alert tone="danger" className="mb-6" title="High-risk payment">
          SSLCommerz flagged the payment for this order as risky. Hold the order and verify the customer (e.g. call them, ask for ID) before shipping.
        </Alert>
      ) : null}
      {order.isDemo ? (
        <Alert tone="info" className="mb-6">
          This is a demo order created by the seed script. It is fictional; no notifications are sent for it and it is removed by “Remove demo data”.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <OrderWorkflow
            orderId={order.id}
            status={order.status}
            paymentMethod={order.paymentMethod}
            paymentStatus={order.paymentStatus}
            transitions={transitions}
            courierName={order.courierName}
            trackingNumber={order.trackingNumber}
            trackingUrl={order.trackingUrl}
          />

          <Panel title={`Items (${items.reduce((s, i) => s + i.quantity, 0)})`} bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-5 py-4 text-[13.5px]">
                  <div className="relative h-16 w-12 shrink-0 bg-linen">{item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="48px" className="object-cover" /> : null}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.productName}</p>
                    <p className="text-[12px] text-muted">
                      {[item.variantLabel, `SKU ${item.sku}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <p className="text-muted tabular-nums">
                    {formatBDT(item.unitPrice)} × {item.quantity}
                  </p>
                  <p className="w-24 text-right font-medium tabular-nums">{formatBDT(item.lineTotal)}</p>
                </li>
              ))}
            </ul>
            <dl className="space-y-2 border-t border-line bg-bone/40 px-5 py-4 text-[13.5px]">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="tabular-nums">{formatBDT(order.subtotal)}</dd>
              </div>
              {order.discountTotal ? (
                <div className="flex justify-between text-success">
                  <dt>Discount {order.couponCode ? `(${order.couponCode})` : ''}</dt>
                  <dd className="tabular-nums">−{formatBDT(order.discountTotal)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted">Delivery · {order.shippingZoneName}</dt>
                <dd className="tabular-nums">{order.shippingFee ? formatBDT(order.shippingFee) : 'Free'}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-[15px] font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatBDT(order.total)}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Timeline">
            <ol className="space-y-4">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 text-[13.5px]">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.visibleToCustomer ? 'bg-gold' : 'bg-line-strong')} />
                  <div>
                    <p>
                      {e.message}
                      {!e.visibleToCustomer ? <span className="ml-2 text-[11px] uppercase tracking-[0.1em] text-muted">Internal</span> : null}
                    </p>
                    <p className="text-[12px] text-muted">
                      {formatDateTime(e.createdAt)}
                      {e.actorName ? ` · ${e.actorName}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Customer notifications" bodyClassName="p-0">
            {notifications.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted">No email or SMS notifications for this order yet.</p>
            ) : (
              <ul className="divide-y divide-line text-[12.5px]">
                {notifications.map((n) => (
                  <li key={n.id} className="grid gap-0.5 px-5 py-3 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <p className="truncate">
                        <span className="mr-2 uppercase tracking-[0.08em] text-muted">{n.channel}</span>
                        {n.subject ?? n.template.replace(/_/g, ' ')}
                      </p>
                      <p className="truncate text-muted">
                        To {n.recipient} · {formatDateTime(n.createdAt)}
                        {n.attempts > 1 ? ` · ${n.attempts} attempts` : ''}
                      </p>
                      {n.lastError ? <p className="text-danger">{n.lastError}</p> : null}
                    </div>
                    <Badge tone={n.status === 'sent' ? 'success' : n.status === 'failed' ? 'danger' : n.status === 'pending' ? 'warning' : 'neutral'}>
                      {n.status === 'skipped' ? 'not sent' : n.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Customer">
            <div className="space-y-1 text-[13.5px]">
              <p className="font-medium">{order.customerName}</p>
              <p>
                <a href={`tel:${order.phone}`} className="hover:underline">
                  {formatBdPhone(order.phone)}
                </a>
              </p>
              {order.email ? <p className="text-muted">{order.email}</p> : null}
              {customer ? (
                <Link href={`/admin/customers/${customer.id}`} className="mt-2 inline-block text-[12.5px] underline underline-offset-4">
                  View customer profile
                </Link>
              ) : (
                <p className="mt-2 text-[12px] text-muted">Guest checkout</p>
              )}
            </div>
          </Panel>
          <Panel title="Delivery address">
            <p className="text-[13.5px] leading-relaxed">
              {order.addressLine}
              <br />
              {order.area}, {order.district}
              {order.postalCode ? ` ${order.postalCode}` : ''}
              <br />
              {order.division} Division
            </p>
            {order.customerNote ? <p className="mt-3 border-l-2 border-gold pl-3 text-[13px] italic text-muted">“{order.customerNote}”</p> : null}
          </Panel>
          <AdminNoteEditor orderId={order.id} initial={order.adminNote ?? ''} />
          {order.status === 'shipped' || order.status === 'delivered' ? (
            <ShippingEditor orderId={order.id} courierName={order.courierName} trackingNumber={order.trackingNumber} trackingUrl={order.trackingUrl} />
          ) : null}
          {returns.length ? (
            <Panel title="Return requests" bodyClassName="p-0">
              <ul className="divide-y divide-line text-[13px]">
                {returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link href={`/admin/returns/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                      {r.requestNumber}
                    </Link>
                    <span className="text-[12px] text-muted">{RETURN_STATUS_LABEL[r.status]}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel title="Payment & refunds">
            <dl className="space-y-1.5 text-[13.5px]">
              <div className="flex justify-between">
                <dt className="text-muted">Method</dt>
                <dd>{PAYMENT_METHOD_LABEL[order.paymentMethod]}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Status</dt>
                <dd>
                  <PaymentStatusBadge status={order.paymentStatus} />
                </dd>
              </div>
              {order.refundedTotal ? (
                <div className="flex justify-between">
                  <dt className="text-muted">Refunded</dt>
                  <dd className="tabular-nums">{formatBDT(order.refundedTotal)}</dd>
                </div>
              ) : null}
            </dl>
            {refunds.length ? (
              <ul className="mt-4 space-y-2 border-t border-line pt-3 text-[12.5px]">
                {refunds.map((r) => (
                  <li key={r.id}>
                    <p className="flex justify-between">
                      <span>{REFUND_METHOD_LABEL[r.method as RefundMethod] ?? r.method}</span>
                      <span className="tabular-nums">{formatBDT(r.amount)}</span>
                    </p>
                    <p className="text-muted">
                      {formatDateTime(r.createdAt)}
                      {r.actorName ? ` · ${r.actorName}` : ''}
                      {r.reference ? ` · Ref ${r.reference}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <RefundPanel
                orderId={order.id}
                refundable={refundable}
                paymentMethod={order.paymentMethod}
                returnRequests={returns}
                canRecord={can(viewer.role, 'refunds:manage')}
              />
              {order.paymentMethod === 'sslcommerz' && gatewayConfigured ? <ReconcileButton orderId={order.id} /> : null}
            </div>
            {refundable > 0 && !can(viewer.role, 'refunds:manage') ? (
              <p className="mt-3 text-[12px] text-muted">Refunds are recorded by an administrator.</p>
            ) : null}
          </Panel>
          {transactions.length ? (
            <Panel title="Payment transactions" bodyClassName="p-0">
              <ul className="divide-y divide-line text-[12.5px]">
                {transactions.map((t) => (
                  <li key={t.id} className="space-y-0.5 px-5 py-3">
                    <p className="flex justify-between">
                      <span className="font-medium">{t.tranId}</span>
                      <span className="uppercase tracking-[0.08em]">{t.status}</span>
                    </p>
                    <p className="text-muted">
                      {formatBDT(t.amount)} · {formatDateTime(t.createdAt)}
                    </p>
                    {t.cardType ? <p className="text-muted">Method: {t.cardType}</p> : null}
                    {t.bankTranId ? <p className="text-muted">Bank ref: {t.bankTranId}</p> : null}
                    {t.failureReason ? <p className="text-danger">{t.failureReason}</p> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
