import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Alert } from '@/components/ui/feedback';
import { OrderStatusBadge, PageHeader, Panel, PaymentStatusBadge, ReturnStatusBadge } from '@/components/admin/ui';
import { RefundPanel } from '@/components/admin/order-actions';
import { ReturnActions } from '@/components/admin/returns-support';
import { requireAdminPage } from '@/server/auth/current-user';
import { getReturnAdmin } from '@/server/services/returns';
import { formatBDT } from '@/lib/money';
import { can } from '@/lib/permissions';
import { formatBdPhone } from '@/lib/phone';
import { REFUND_METHOD_LABEL, RETURN_REASON_LABEL, type RefundMethod } from '@/lib/returns';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Return' };

export default async function AdminReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminPage('returns:manage', `/admin/returns/${id}`);
  const { request, order, items, refunds, suggestedRefund } = await getReturnAdmin(id);
  const refundable = order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded' ? order.total - order.refundedTotal : 0;

  return (
    <>
      <PageHeader
        back={{ href: '/admin/returns', label: 'Returns' }}
        title={request.requestNumber}
        description={`Requested ${formatDateTime(request.createdAt)} · ${RETURN_REASON_LABEL[request.reason]}`}
        actions={<ReturnStatusBadge status={request.status} />}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <ReturnActions id={request.id} status={request.status} />
          <Panel title="Items to return" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.orderItemId} className="flex items-center gap-4 px-5 py-4 text-[13.5px]">
                  <div className="relative h-16 w-12 shrink-0 bg-linen">{item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="48px" className="object-cover" /> : null}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.productName}</p>
                    <p className="text-[12px] text-muted">{[item.variantLabel, `SKU ${item.sku}`].filter(Boolean).join(' · ')}</p>
                  </div>
                  <p className="text-muted tabular-nums">
                    {item.quantity} of {item.orderedQuantity} × {formatBDT(item.unitPrice)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
          {request.customerNote ? (
            <Panel title="Customer’s note">
              <p className="whitespace-pre-wrap text-[13.5px]">{request.customerNote}</p>
            </Panel>
          ) : null}
          {request.resolutionNote ? (
            <Panel title="Message shown to the customer">
              <p className="whitespace-pre-wrap text-[13.5px]">{request.resolutionNote}</p>
            </Panel>
          ) : null}
        </div>
        <div className="space-y-6">
          <Panel title="Order">
            <div className="space-y-2 text-[13.5px]">
              <Link href={`/admin/orders/${order.id}`} className="font-medium underline-offset-4 hover:underline">
                {order.orderNumber}
              </Link>
              <div className="flex flex-wrap gap-2">
                <OrderStatusBadge status={order.status} />
                <PaymentStatusBadge status={order.paymentStatus} />
              </div>
              <p>{order.customerName}</p>
              <p>
                <a href={`tel:${order.phone}`} className="hover:underline">
                  {formatBdPhone(order.phone)}
                </a>
              </p>
              {order.email ? <p className="text-muted">{order.email}</p> : null}
              {order.deliveredAt ? <p className="text-[12px] text-muted">Delivered {formatDateTime(order.deliveredAt)}</p> : null}
            </div>
          </Panel>
          <Panel title="Refund">
            <dl className="space-y-1.5 text-[13.5px]">
              <div className="flex justify-between">
                <dt className="text-muted">Suggested</dt>
                <dd className="tabular-nums">{formatBDT(suggestedRefund)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Order total / refunded</dt>
                <dd className="tabular-nums">
                  {formatBDT(order.total)} / {formatBDT(order.refundedTotal)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] text-muted">Suggested = returned items minus their share of any discount. Delivery fees are not included.</p>
            {refunds.length ? (
              <ul className="mt-4 space-y-2 border-t border-line pt-3 text-[12.5px]">
                {refunds.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span>
                      {REFUND_METHOD_LABEL[r.method as RefundMethod] ?? r.method}
                      {r.reference ? ` · ${r.reference}` : ''}
                    </span>
                    <span className="tabular-nums">{formatBDT(r.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4">
              {request.status === 'received' ? (
                <RefundPanel
                  orderId={order.id}
                  refundable={refundable}
                  defaultAmount={Math.min(refundable, suggestedRefund || refundable)}
                  paymentMethod={order.paymentMethod}
                  returnRequests={[{ id: request.id, requestNumber: request.requestNumber, status: request.status }]}
                  canRecord={can(viewer.role, 'refunds:manage')}
                />
              ) : request.status === 'refunded' ? (
                <Alert tone="success">Refund recorded.</Alert>
              ) : (
                <p className="text-[12.5px] text-muted">Record the refund after the items are received.</p>
              )}
              {request.status === 'received' && !can(viewer.role, 'refunds:manage') ? (
                <p className="mt-2 text-[12px] text-muted">An administrator records the refund.</p>
              ) : null}
            </div>
          </Panel>
          {request.adminNote ? (
            <Panel title="Internal note">
              <p className="whitespace-pre-wrap text-[13px]">{request.adminNote}</p>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
