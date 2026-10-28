'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Badge } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { formatBDT } from '@/lib/money';
import { ORDER_STATUS_DESCRIPTION, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, type OrderStatus, type PaymentMethod, type PaymentStatus } from '@/lib/order-status';
import { formatDateTime } from '@/lib/utils';
import { OrderEvents, OrderProgress } from './order-timeline';

type TrackResult = {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  total: number;
  placedAt: string;
  district: string;
  phoneMasked: string;
  courierName: string | null;
  trackingNumber: string | null;
  itemCount: number;
  events: { id: string; message: string; createdAt: string }[];
};

export function TrackOrderForm({ initialOrderNumber }: { initialOrderNumber: string }) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackResult | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setErrors({});
    const res = await api<TrackResult>('/api/v1/orders/track', { body: { orderNumber, phone } });
    setLoading(false);
    if (res.ok) setResult(res.data);
    else {
      setResult(null);
      if (res.error.fields) setErrors(res.error.fields);
      else setError(res.error.message);
    }
  };

  return (
    <div className="mt-10">
      <form onSubmit={submit} className="grid gap-5 border border-line p-6 sm:grid-cols-[1fr_1fr_auto] sm:items-start md:p-8" noValidate>
        <Field label="Order number" error={errors.orderNumber}>
          {(p) => <Input {...p} placeholder="MKJ-261028-XXXXX" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="uppercase placeholder:normal-case" />}
        </Field>
        <Field label="Mobile number" error={errors.phone}>
          {(p) => <Input {...p} type="tel" inputMode="tel" placeholder="01XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        <Button type="submit" loading={loading} className="sm:mt-[22px]">
          Track
        </Button>
      </form>

      {error ? <Alert tone="danger" className="mt-6">{error}</Alert> : null}

      {result ? (
        <section className="mt-10 animate-fade-up border border-line p-6 md:p-8" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow text-muted">Order</p>
              <h2 className="mt-1 font-display text-[30px] leading-none">{result.orderNumber}</h2>
              <p className="mt-2 text-[13px] text-muted">
                Placed {formatDateTime(result.placedAt)} · {result.itemCount} items · {formatBDT(result.total)} · to {result.district} ({result.phoneMasked})
              </p>
            </div>
            <div className="flex gap-2">
              <Badge tone="outline">{PAYMENT_METHOD_LABEL[result.paymentMethod]}</Badge>
              <Badge tone={result.paymentStatus === 'paid' ? 'success' : 'neutral'}>{PAYMENT_STATUS_LABEL[result.paymentStatus]}</Badge>
            </div>
          </div>
          <div className="mt-8">
            <OrderProgress status={result.status} />
            <p className="mt-5 text-[14px] text-muted">{ORDER_STATUS_DESCRIPTION[result.status]}</p>
            {result.courierName ? (
              <p className="mt-1 text-[14px]">
                {result.courierName}
                {result.trackingNumber ? ` · Tracking no. ${result.trackingNumber}` : ''}
              </p>
            ) : null}
          </div>
          <div className="mt-8 border-t border-line pt-6">
            <OrderEvents events={result.events} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
