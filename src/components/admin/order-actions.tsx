'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { formatBDT } from '@/lib/money';
import { ORDER_STATUS_LABEL, type OrderStatus, type PaymentMethod, type PaymentStatus } from '@/lib/order-status';
import { REFUND_METHOD_LABEL, REFUND_METHODS, type RefundMethod } from '@/lib/returns';
import { Panel } from './ui';

const ACTION_LABEL: Record<OrderStatus, string> = {
  pending: 'Mark pending',
  confirmed: 'Confirm order',
  processing: 'Start packing',
  shipped: 'Mark as shipped',
  delivered: 'Mark as delivered',
  cancelled: 'Cancel order',
  returned: 'Returned to sender',
};

const COURIERS = ['Pathao Courier', 'Steadfast Courier', 'RedX', 'Paperfly', 'eCourier', 'Sundarban Courier', 'SA Paribahan'];

export function OrderWorkflow({
  orderId,
  status,
  paymentMethod,
  paymentStatus,
  transitions,
  courierName,
  trackingNumber,
  trackingUrl,
}: {
  orderId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  transitions: { to: OrderStatus; blocked: boolean }[];
  courierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState('');
  const [courier, setCourier] = useState(courierName ?? '');
  const [tracking, setTracking] = useState(trackingNumber ?? '');
  const [trackingLink, setTrackingLink] = useState(trackingUrl ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const run = async (to: OrderStatus) => {
    setBusy(true);
    const result = await api(`/api/v1/admin/orders/${orderId}/status`, {
      body: { status: to, note: note || null, courierName: courier || null, trackingNumber: tracking || null, trackingUrl: trackingLink || null },
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

  const markCashReceived = async () => {
    setBusy(true);
    const result = await api(`/api/v1/admin/orders/${orderId}/payment`, { body: { action: 'mark_paid', note: null } });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    toast('Payment recorded');
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
          Online payment hasn’t been confirmed by SSLCommerz yet, so this order can’t be fulfilled. It updates automatically when the gateway confirms the
          payment; otherwise it is cancelled when the payment window closes.
        </Alert>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-[13px]">
        <span className="text-muted">Payment:</span>
        {paymentMethod === 'cod' && paymentStatus === 'unpaid' && status !== 'cancelled' ? (
          <Button caps={false} size="sm" variant="outline" onClick={markCashReceived} loading={busy}>
            Record cash received
          </Button>
        ) : null}
        <span className="text-[12px] text-muted">
          {paymentMethod === 'cod'
            ? 'COD orders are marked paid automatically on delivery.'
            : 'Online payments are confirmed only by the gateway’s server-to-server validation.'}
        </span>
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => (o ? undefined : setDialog(null))}
        title={dialog ? ACTION_LABEL[dialog] : ''}
        description={
          dialog === 'cancelled'
            ? 'Stock is returned to inventory and any coupon use is released. The customer is notified.'
            : dialog === 'returned'
              ? 'Use this when the courier brings the parcel back undelivered (RTO). All items go back into stock. For customer returns after delivery, use the Returns page.'
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
              <Field label="Tracking link" error={errors.trackingUrl} className="sm:col-span-2" hint="Optional https:// link to the courier’s tracking page.">
                {(p) => <Input {...p} type="url" inputMode="url" value={trackingLink} onChange={(e) => setTrackingLink(e.target.value)} placeholder="https://" />}
              </Field>
              <datalist id="couriers">
                {COURIERS.map((c) => (
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

/** Edit courier / tracking details after the order has shipped. */
export function ShippingEditor({
  orderId,
  courierName,
  trackingNumber,
  trackingUrl,
}: {
  orderId: string;
  courierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ courierName: courierName ?? '', trackingNumber: trackingNumber ?? '', trackingUrl: trackingUrl ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const result = await api(`/api/v1/admin/orders/${orderId}/shipping`, {
      method: 'PUT',
      body: { courierName: v.courierName, trackingNumber: v.trackingNumber || null, trackingUrl: v.trackingUrl || null },
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      return toast.error(result.error.message);
    }
    toast('Tracking updated');
    setOpen(false);
    router.refresh();
  };
  return (
    <Panel title="Shipment">
      <dl className="space-y-1.5 text-[13.5px]">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Courier</dt>
          <dd>{courierName ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Tracking no.</dt>
          <dd className="tabular-nums">{trackingNumber ?? '—'}</dd>
        </div>
        {trackingUrl ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Link</dt>
            <dd className="truncate">
              <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                Open tracking
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      <Button caps={false} size="sm" variant="outline" className="mt-4" onClick={() => setOpen(true)}>
        Edit tracking
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Edit tracking"
        footer={
          <>
            <Button variant="outline" caps={false} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button caps={false} onClick={save} loading={busy}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Courier" required error={errors.courierName}>
            {(p) => <Input {...p} list="couriers-edit" value={v.courierName} onChange={(e) => setV({ ...v, courierName: e.target.value })} />}
          </Field>
          <Field label="Tracking number" error={errors.trackingNumber}>
            {(p) => <Input {...p} value={v.trackingNumber} onChange={(e) => setV({ ...v, trackingNumber: e.target.value })} />}
          </Field>
          <Field label="Tracking link" error={errors.trackingUrl}>
            {(p) => <Input {...p} type="url" value={v.trackingUrl} onChange={(e) => setV({ ...v, trackingUrl: e.target.value })} placeholder="https://" />}
          </Field>
          <datalist id="couriers-edit">
            {COURIERS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </Dialog>
    </Panel>
  );
}

/** Records a refund that was ALREADY paid outside the platform. Never moves money. */
export function RefundPanel({
  orderId,
  refundable,
  defaultAmount,
  paymentMethod,
  returnRequests,
  canRecord,
}: {
  orderId: string;
  refundable: number;
  defaultAmount?: number;
  paymentMethod: PaymentMethod;
  returnRequests: { id: string; requestNumber: string; status: string }[];
  canRecord: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const eligibleReturns = returnRequests.filter((r) => r.status === 'received');
  const [v, setV] = useState<{ amount: number | null; method: RefundMethod; reference: string; note: string; returnRequestId: string; confirm: boolean }>({
    amount: defaultAmount ?? refundable,
    method: paymentMethod === 'sslcommerz' ? 'sslcommerz_panel' : 'bkash',
    reference: '',
    note: '',
    returnRequestId: eligibleReturns[0]?.id ?? '',
    confirm: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const result = await api(`/api/v1/admin/orders/${orderId}/refunds`, {
      body: {
        amount: v.amount ?? 0,
        method: v.method,
        reference: v.reference || null,
        note: v.note || null,
        returnRequestId: v.returnRequestId || null,
        confirmPaidOutside: v.confirm,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      return toast.error(result.error.message);
    }
    toast('Refund recorded');
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      {canRecord && refundable > 0 ? (
        <Button caps={false} size="sm" variant="outline" onClick={() => (setErrors({}), setOpen(true))} data-testid="record-refund">
          Record refund…
        </Button>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Record a refund"
        description="MKJ MART does not move money. First refund the customer (SSLCommerz merchant panel, bKash, Nagad, bank transfer or cash), then record it here with the reference."
        footer={
          <>
            <Button variant="outline" caps={false} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button caps={false} onClick={submit} loading={busy} disabled={!v.confirm}>
              Record refund
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-[13px] text-muted">Up to {formatBDT(refundable)} can still be refunded on this order.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount refunded" required error={errors.amount}>
              {(p) => <MoneyInput {...p} value={v.amount} onChange={(x) => setV({ ...v, amount: x })} />}
            </Field>
            <Field label="Paid via" required error={errors.method}>
              {(p) => (
                <Select {...p} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as RefundMethod })}>
                  {REFUND_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {REFUND_METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {eligibleReturns.length ? (
            <Field label="For return request" error={errors.returnRequestId}>
              {(p) => (
                <Select {...p} value={v.returnRequestId} onChange={(e) => setV({ ...v, returnRequestId: e.target.value })}>
                  <option value="">Not linked to a return</option>
                  {eligibleReturns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.requestNumber}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Reference" error={errors.reference} hint="Gateway refund ID, bKash TrxID, bank reference…">
            {(p) => <Input {...p} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />}
          </Field>
          <Field label="Note" error={errors.note}>
            {(p) => <Textarea {...p} rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />}
          </Field>
          <Checkbox
            label="I confirm this money has already been refunded to the customer."
            checked={v.confirm}
            onChange={(e) => setV({ ...v, confirm: e.target.checked })}
          />
          {errors.confirmPaidOutside ? <p className="text-[12.5px] text-danger">{errors.confirmPaidOutside}</p> : null}
        </div>
      </Dialog>
    </>
  );
}

/** Asks SSLCommerz (Transaction Query API) whether the order was paid. */
export function ReconcileButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    const result = await api<{ outcome: 'paid' | 'unpaid' | 'unreachable' }>(`/api/v1/admin/orders/${orderId}/reconcile`, { body: {} });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    const messages = {
      paid: 'SSLCommerz confirms a successful payment — recorded.',
      unpaid: 'SSLCommerz reports no successful payment for this order.',
      unreachable: 'SSLCommerz could not be reached. Try again later.',
    } as const;
    toast(messages[result.data.outcome]);
    router.refresh();
  };
  return (
    <Button caps={false} size="sm" variant="outline" onClick={check} loading={busy}>
      Check payment with gateway
    </Button>
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
