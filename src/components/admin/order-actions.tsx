'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { ORDER_STATUS_LABEL, type OrderStatus, type PaymentMethod, type PaymentStatus } from '@/lib/order-status';
import { Panel } from './ui';

const ACTION_LABEL: Record<OrderStatus, string> = {
  pending: 'Mark pending',
  confirmed: 'Confirm order',
  processing: 'Start packing',
  shipped: 'Mark as shipped',
  delivered: 'Mark as delivered',
  cancelled: 'Cancel order',
  returned: 'Record return',
};

export function OrderWorkflow({
  orderId,
  status,
  paymentMethod,
  paymentStatus,
  transitions,
  courierName,
  trackingNumber,
}: {
  orderId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  transitions: { to: OrderStatus; blocked: boolean }[];
  courierName: string | null;
  trackingNumber: string | null;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState('');
  const [courier, setCourier] = useState(courierName ?? '');
  const [tracking, setTracking] = useState(trackingNumber ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const run = async (to: OrderStatus) => {
    setBusy(true);
    const result = await api(`/api/v1/admin/orders/${orderId}/status`, {
      body: { status: to, note: note || null, courierName: courier || null, trackingNumber: tracking || null },
    });
    setBusy(false);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      toast.error(result.error.message);
      return;
    }
    toast(`Order ${ORDER_STATUS_LABEL[to].toLowerCase()}`);
    setDialog(null);
    setNote('');
    router.refresh();
  };

  const payment = async (action: 'mark_paid' | 'mark_refunded') => {
    setBusy(true);
    const result = await api(`/api/v1/admin/orders/${orderId}/payment`, { body: { action, note: null } });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    toast(action === 'mark_paid' ? 'Payment recorded' : 'Refund recorded');
    router.refresh();
  };

  const needsDialog = (to: OrderStatus) => to === 'cancelled' || to === 'shipped' || to === 'returned';
  const blockedOnline = transitions.some((t) => t.blocked);

  return (
    <Panel title="Fulfilment">
      {transitions.length === 0 ? (
        <p className="text-[13.5px] text-muted">This order is {ORDER_STATUS_LABEL[status].toLowerCase()} — no further status changes are possible.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {transitions.map(({ to, blocked }) => (
            <Button
              key={to}
              caps={false}
              variant={to === 'cancelled' ? 'danger-outline' : to === 'returned' ? 'outline' : 'primary'}
              size="sm"
              disabled={blocked || busy}
              onClick={() => (needsDialog(to) ? (setErrors({}), setDialog(to)) : run(to))}
              data-testid={`order-action-${to}`}
            >
              {ACTION_LABEL[to]}
            </Button>
          ))}
        </div>
      )}
      {blockedOnline ? (
        <Alert tone="warning" className="mt-4">
          Online payment hasn’t been confirmed by SSLCommerz yet, so this order can’t be fulfilled. It will update automatically when the payment arrives, or expire.
        </Alert>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-[13px]">
        <span className="text-muted">Payment:</span>
        {paymentMethod === 'cod' && paymentStatus === 'unpaid' && status !== 'cancelled' ? (
          <Button caps={false} size="sm" variant="outline" onClick={() => payment('mark_paid')} loading={busy}>
            Record cash received
          </Button>
        ) : null}
        {paymentStatus === 'paid' && (status === 'cancelled' || status === 'returned') ? (
          <Button caps={false} size="sm" variant="outline" onClick={() => payment('mark_refunded')} loading={busy}>
            Record refund issued
          </Button>
        ) : null}
        <span className="text-[12px] text-muted">
          {paymentMethod === 'cod' ? 'COD orders are marked paid automatically on delivery.' : 'Online payments are confirmed by the gateway; refunds are made in the SSLCommerz dashboard.'}
        </span>
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => (o ? undefined : setDialog(null))}
        title={dialog ? ACTION_LABEL[dialog] : ''}
        description={
          dialog === 'cancelled'
            ? 'Stock is returned to inventory and any coupon use is released. The customer sees the cancellation.'
            : dialog === 'returned'
              ? 'Returned items go back into stock. Record the refund separately once paid.'
              : 'Add courier details so the customer can follow the parcel.'
        }
        footer={
          <>
            <Button variant="outline" caps={false} onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button variant={dialog === 'cancelled' ? 'danger' : 'primary'} caps={false} onClick={() => dialog && run(dialog)} loading={busy}>
              {dialog ? ACTION_LABEL[dialog] : ''}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {dialog === 'shipped' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Courier" required error={errors.courierName}>
                {(p) => <Input {...p} list="couriers" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="e.g. Pathao Courier" />}
              </Field>
              <Field label="Tracking number" error={errors.trackingNumber}>
                {(p) => <Input {...p} value={tracking} onChange={(e) => setTracking(e.target.value)} />}
              </Field>
              <datalist id="couriers">
                {['Pathao Courier', 'Steadfast Courier', 'RedX', 'Paperfly', 'eCourier', 'Sundarban Courier', 'SA Paribahan'].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          ) : null}
          <Field label={dialog === 'cancelled' ? 'Reason (shown to the customer)' : 'Internal note'} error={errors.note}>
            {(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </Panel>
  );
}

export function AdminNoteEditor({ orderId, initial }: { orderId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const result = await api(`/api/v1/admin/orders/${orderId}/note`, { method: 'PUT', body: { adminNote: value || null } });
    setSaving(false);
    if (!result.ok) return toast.error(result.error.message);
    toast('Note saved');
  };
  return (
    <Panel title="Internal note">
      <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Visible to staff only" aria-label="Internal note" />
      <Button caps={false} size="sm" variant="outline" className="mt-3" onClick={save} loading={saving} disabled={value === initial}>
        Save note
      </Button>
    </Panel>
  );
}
