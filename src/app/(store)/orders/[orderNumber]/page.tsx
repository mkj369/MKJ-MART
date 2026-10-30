import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { buttonClasses } from '@/components/ui/button';
import { OrderActions, ReturnsPanel } from '@/components/store/order-actions';
import { OrderEvents, OrderProgress } from '@/components/store/order-timeline';
import { getCurrentUser } from '@/server/auth/current-user';
import { getOrderForViewer } from '@/server/services/orders';
import { formatBDT } from '@/lib/money';
import { formatBdPhone } from '@/lib/phone';
import { ORDER_STATUS_DESCRIPTION, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/order-status';
import { formatDateTime } from '@/lib/utils';

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });

export const metadata: Metadata = { title: 'Your order', robots: { index: false } };

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrderPage({ params, searchParams }: Props) {
  const [{ orderNumber }, sp, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  const token = typeof sp.token === 'string' ? sp.token : null;
  const order = await getOrderForViewer(orderNumber.toUpperCase(), { userId: user?.id, token });

  if (!order) {
    return (
      <div className="container-x pt-12">
        <EmptyState
          className="border border-line"
          title="We couldn’t open this order"
          description="The link may be incomplete, or the order belongs to another account. Sign in, or track it with your order number and phone."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href={`/login?next=/orders/${encodeURIComponent(orderNumber)}`} className={buttonClasses({ variant: 'primary' })}>
                Sign in
              </Link>
              <Link href="/track-order" className={buttonClasses({ variant: 'outline' })}>
                Track an order
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const placed = sp.placed === '1';
  const payment = typeof sp.payment === 'string' ? sp.payment : null;
  const firstName = order.customerName.split(' ')[0];

  return (
    <div className="container-x max-w-6xl pt-10">
      {placed || payment === 'paid' ? (
        <div className="animate-fade-up border-b border-line pb-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-gold-deep" strokeWidth={1.1} />
          <p className="eyebrow mt-5 text-gold-deep">{payment === 'paid' ? 'Payment received' : 'Order placed'}</p>
          <h1 className="mt-3 font-display text-[40px] font-light leading-tight md:text-[54px]">Thank you, {firstName}.</h1>
          <p className="mx-auto mt-3 max-w-lg text-[15px] text-muted">
            {order.paymentMethod === 'cod'
              ? 'We’ll call you shortly to confirm your order, then pack it with care. Please keep the cash ready on delivery.'
              : 'Your payment is confirmed and your order is now being prepared.'}
          </p>
          {!user && token ? (
            <p className="mx-auto mt-5 max-w-lg border border-gold-light bg-[#faf6ee] px-4 py-3 text-[13px] text-gold-deep">
              Bookmark this page to check your order any time — or track it with your order number and phone number.
            </p>
          ) : null}
        </div>
      ) : null}

      {(payment === 'failed' || payment === 'cancelled') && order.canRetryPayment ? (
        <Alert tone="warning" className="mb-8" title={payment === 'cancelled' ? 'Payment cancelled' : 'Payment not completed'}>
          Your online payment didn’t go through and no money was taken. Your items are reserved until{' '}
          {order.paymentExpiresAt ? timeFormat.format(order.paymentExpiresAt) : 'shortly'} — use “Pay now” to try again, or cancel the order.
        </Alert>
      ) : null}
      {(payment === 'failed' || payment === 'cancelled') && !order.canRetryPayment && order.status === 'cancelled' ? (
        <Alert tone="danger" className="mb-8" title={payment === 'cancelled' ? 'Payment cancelled' : 'Payment not completed'}>
          Your online payment didn’t go through, so this order was cancelled and the items were released. If your account was charged,
          contact us with your order number. You can restore the items to your bag and order again.
        </Alert>
      ) : null}
      {payment === 'pending' && order.paymentStatus !== 'paid' ? (
        <Alert tone="warning" className="mb-8" title="Confirming your payment">
          We are waiting for confirmation from the payment gateway. Refresh this page in a minute — please don’t pay twice.
        </Alert>
      ) : null}
      {!payment && order.canRetryPayment && order.paymentStatus !== 'pending' ? (
        <Alert tone="warning" className="mb-8" title="Payment needed">
          This order is waiting for online payment. Your items are reserved until {order.paymentExpiresAt ? timeFormat.format(order.paymentExpiresAt) : 'shortly'}.
        </Alert>
      ) : null}

      <div className="mt-10 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="eyebrow text-muted">Order</p>
          <h2 className="mt-2 font-display text-[34px] leading-none" data-testid="order-number">
            {order.orderNumber}
          </h2>
          <p className="mt-2 text-[13px] text-muted">Placed {formatDateTime(order.placedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={order.status === 'cancelled' ? 'danger' : order.status === 'delivered' ? 'success' : 'ink'}>{ORDER_STATUS_LABEL[order.status]}</Badge>
          <Badge tone={order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'failed' ? 'danger' : 'neutral'}>
            {PAYMENT_STATUS_LABEL[order.paymentStatus]}
          </Badge>
          {order.isDemo ? <Badge tone="gold">Demo order</Badge> : null}
        </div>
      </div>

      <div className="mt-10">
        <OrderProgress status={order.status} />
        <p className="mt-5 text-[14px] text-muted">{ORDER_STATUS_DESCRIPTION[order.status]}</p>
        {order.courierName ? (
          <p className="mt-1 text-[14px]">
            Courier: <span className="font-medium">{order.courierName}</span>
            {order.trackingNumber ? <> · Tracking no. <span className="font-medium">{order.trackingNumber}</span></> : null}
            {order.trackingUrl ? (
              <>
                {' '}
                ·{' '}
                <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                  Track parcel
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_360px]">
        <div>
          <h3 className="eyebrow border-b border-line pb-3">Items</h3>
          <ul className="divide-y divide-line">
            {order.items.map((item) => (
              <li key={item.id} className="flex gap-4 py-5">
                <div className="relative h-[100px] w-[75px] shrink-0 bg-linen">
                  {item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="80px" className="object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  {item.productSlug ? (
                    <Link href={`/products/${item.productSlug}`} className="text-[14.5px] hover:underline">
                      {item.productName}
                    </Link>
                  ) : (
                    <p className="text-[14.5px]">{item.productName}</p>
                  )}
                  <p className="mt-1 text-[12.5px] text-muted">
                    {[item.variantLabel, `Qty ${item.quantity}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <p className="text-[14.5px] tabular-nums">{formatBDT(item.lineTotal)}</p>
              </li>
            ))}
          </ul>

          <h3 className="eyebrow mt-12 border-b border-line pb-3">Updates</h3>
          <div className="mt-6">
            <OrderEvents events={order.events} />
          </div>
        </div>

        <aside className="space-y-8">
          <div className="border border-line bg-bone p-6">
            <h3 className="eyebrow">Summary</h3>
            <dl className="mt-5 space-y-2.5 text-[14px]">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="tabular-nums">{formatBDT(order.subtotal)}</dd>
              </div>
              {order.discountTotal > 0 ? (
                <div className="flex justify-between text-success">
                  <dt>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</dt>
                  <dd className="tabular-nums">−{formatBDT(order.discountTotal)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted">Delivery ({order.shippingZoneName})</dt>
                <dd className="tabular-nums">{order.shippingFee ? formatBDT(order.shippingFee) : 'Free'}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-3 text-[16px] font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatBDT(order.total)}</dd>
              </div>
              {order.refundedTotal > 0 ? (
                <div className="flex justify-between text-[13.5px] text-muted">
                  <dt>Refunded</dt>
                  <dd className="tabular-nums">−{formatBDT(order.refundedTotal)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-4 text-[13px] text-muted">{PAYMENT_METHOD_LABEL[order.paymentMethod]}</p>
          </div>
          <div className="border border-line p-6 text-[14px]">
            <h3 className="eyebrow">Delivering to</h3>
            <p className="mt-4 font-medium">{order.customerName}</p>
            <p className="mt-1 text-muted">{formatBdPhone(order.phone)}</p>
            <p className="mt-3 leading-relaxed">
              {order.address.addressLine}
              <br />
              {order.address.area}, {order.address.district}
              {order.address.postalCode ? ` ${order.address.postalCode}` : ''}
              <br />
              {order.address.division} Division
            </p>
            {order.customerNote ? <p className="mt-3 text-[13px] italic text-muted">“{order.customerNote}”</p> : null}
          </div>
          <OrderActions
            orderNumber={order.orderNumber}
            token={token}
            canCancel={order.canCancel}
            canRestore={order.status === 'cancelled' && order.paymentMethod === 'sslcommerz' && order.paymentStatus !== 'paid'}
            canRetryPayment={order.canRetryPayment}
          />
          <ReturnsPanel
            orderNumber={order.orderNumber}
            token={token}
            items={order.items.map((i) => ({ id: i.id, productName: i.productName, variantLabel: i.variantLabel, quantity: i.quantity }))}
            returns={order.returns}
            eligibility={order.returnEligibility}
          />
          <p className="text-[13px] text-muted">
            Questions about this order?{' '}
            <Link href={`/support?order=${encodeURIComponent(order.orderNumber)}`} className="text-ink underline underline-offset-4">
              Contact us
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
