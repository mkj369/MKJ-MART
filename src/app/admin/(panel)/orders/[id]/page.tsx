import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/feedback';
import { OrderStatusBadge, PageHeader, Panel, PaymentStatusBadge } from '@/components/admin/ui';
import { AdminNoteEditor, OrderWorkflow } from '@/components/admin/order-actions';
import { requireAdminPage } from '@/server/auth/current-user';
import { getOrderAdmin } from '@/server/services/admin/orders';
import { formatBDT } from '@/lib/money';
import { ORDER_TRANSITIONS, PAYMENT_METHOD_LABEL, transitionBlockedByPayment } from '@/lib/order-status';
import { formatBdPhone } from '@/lib/phone';
import { cn, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Order' };

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage('orders:manage', `/admin/orders/${id}`);
  const { order, items, events, transactions, customer } = await getOrderAdmin(id);
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
