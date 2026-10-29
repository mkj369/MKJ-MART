'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Field, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { RETURN_REASON_LABEL, RETURN_REASONS, RETURN_STATUS_DESCRIPTION, RETURN_STATUS_LABEL, type ReturnReason, type ReturnStatus } from '@/lib/returns';
import { cn, formatDate } from '@/lib/utils';
import type { CartView } from '@/server/services/cart';
import { useStore } from './store-provider';

export function OrderActions({
  orderNumber,
  token,
  canCancel,
  canRestore,
  canRetryPayment,
}: {
  orderNumber: string;
  token: string | null;
  canCancel: boolean;
  canRestore: boolean;
  canRetryPayment: boolean;
}) {
  const router = useRouter();
  const { setCartCount, openCart } = useStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canCancel && !canRestore && !canRetryPayment) return null;

  const payNow = async () => {
    setBusy(true);
    const result = await api<{ type: 'redirect'; url: string } | { type: 'paid' }>(`/api/v1/orders/${orderNumber}/pay`, {
      body: { token: token ?? undefined },
    });
    if (!result.ok) {
      setBusy(false);
      return toast.error(result.error.message);
    }
    if (result.data.type === 'redirect') {
      window.location.assign(result.data.url);
      return;
    }
    setBusy(false);
    toast('Your payment was already received.');
    router.refresh();
  };

  const cancel = async () => {
    setBusy(true);
    const result = await api(`/api/v1/orders/${orderNumber}/cancel`, { body: { token: token ?? undefined } });
    setBusy(false);
    setConfirmOpen(false);
    if (!result.ok) return toast.error(result.error.message);
    toast('Your order has been cancelled.');
    router.refresh();
  };

  const restore = async () => {
    setBusy(true);
    const result = await api<{ restored: number; cart: CartView }>(`/api/v1/orders/${orderNumber}/restore-cart`, {
      body: { token: token ?? undefined },
    });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    setCartCount(result.data.cart.itemCount);
    if (result.data.restored === 0) toast('These items are no longer available.');
    else openCart();
  };

  return (
    <div className="space-y-3">
      {canRetryPayment ? (
        <Button className="w-full" onClick={payNow} loading={busy} data-testid="pay-now">
          Pay now
        </Button>
      ) : null}
      {canRestore ? (
        <Button className="w-full" onClick={restore} loading={busy}>
          Restore items to my bag
        </Button>
      ) : null}
      {canCancel ? (
        <>
          <Button variant="danger-outline" className="w-full" onClick={() => setConfirmOpen(true)}>
            Cancel order
          </Button>
          <Dialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Cancel this order?"
            description="Your items will be released and the order cannot be restored."
            footer={
              <>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Keep order
                </Button>
                <Button variant="danger" onClick={cancel} loading={busy}>
                  Cancel order
                </Button>
              </>
            }
          >
            <p className="text-[14px] text-muted">You can cancel online while the order is still awaiting confirmation. After that, please contact customer care.</p>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

type ReturnSummary = {
  id: string;
  requestNumber: string;
  status: ReturnStatus;
  reason: ReturnReason;
  resolutionNote: string | null;
  createdAt: string | Date;
  items: { orderItemId: string; quantity: number }[];
};

export function ReturnsPanel({
  orderNumber,
  token,
  items,
  returns,
  eligibility,
}: {
  orderNumber: string;
  token: string | null;
  items: { id: string; productName: string; variantLabel: string | null; quantity: number }[];
  returns: ReturnSummary[];
  eligibility: { eligible: boolean; reason: string | null; deadline: string | Date | null; remaining: Record<string, number> } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason | ''>('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const nameOf = (id: string) => items.find((i) => i.id === id)?.productName ?? 'Item';
  const selected = Object.entries(quantities).filter(([, q]) => q > 0);
  const canRequest = !!eligibility?.eligible;
  if (!canRequest && returns.length === 0 && !eligibility?.reason) return null;

  const setQty = (id: string, q: number) => {
    const max = eligibility?.remaining[id] ?? 0;
    setQuantities({ ...quantities, [id]: Math.max(0, Math.min(max, q)) });
  };

  const submit = async () => {
    const fieldErrors: Record<string, string> = {};
    if (selected.length === 0) fieldErrors.items = 'Choose at least one item to return.';
    if (!reason) fieldErrors.reason = 'Tell us why you are returning the items.';
    if (Object.keys(fieldErrors).length) return setErrors(fieldErrors);
    setBusy(true);
    const result = await api<{ requestNumber: string }>(`/api/v1/orders/${orderNumber}/returns`, {
      body: { items: selected.map(([orderItemId, quantity]) => ({ orderItemId, quantity })), reason, note: note || undefined, token: token ?? undefined },
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      return toast.error(result.error.message);
    }
    toast(`Return ${result.data.requestNumber} requested. We’ll be in touch soon.`);
    setOpen(false);
    setQuantities({});
    setReason('');
    setNote('');
    router.refresh();
  };

  const withdraw = async (requestNumber: string) => {
    const result = await api(`/api/v1/orders/${orderNumber}/returns/${requestNumber}/withdraw`, { body: { token: token ?? undefined } });
    if (!result.ok) return toast.error(result.error.message);
    toast('Return request withdrawn.');
    router.refresh();
  };

  return (
    <div className="border border-line p-6 text-[14px]" data-testid="returns-panel">
      <h3 className="eyebrow">Returns</h3>
      {returns.length ? (
        <ul className="mt-4 space-y-4">
          {returns.map((r) => (
            <li key={r.id} className="border-l-2 border-gold-light pl-3">
              <p className="font-medium">
                {r.requestNumber} · {RETURN_STATUS_LABEL[r.status]}
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {r.items.map((i) => `${nameOf(i.orderItemId)} ×${i.quantity}`).join(', ')} · {formatDate(r.createdAt)}
              </p>
              <p className="mt-1 text-[13px] text-muted">{RETURN_STATUS_DESCRIPTION[r.status]}</p>
              {r.resolutionNote ? <p className="mt-1 whitespace-pre-wrap text-[13px]">{r.resolutionNote}</p> : null}
              {r.status === 'requested' ? (
                <button type="button" className="mt-1 text-[12.5px] text-muted underline underline-offset-4 hover:text-ink" onClick={() => withdraw(r.requestNumber)}>
                  Withdraw request
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canRequest ? (
        <>
          <p className="mt-4 text-[13px] text-muted">
            Not right? You can request a return
            {eligibility?.deadline ? ` until ${formatDate(eligibility.deadline)}` : ''}.
          </p>
          <Button variant="outline" className="mt-4 w-full" onClick={() => (setErrors({}), setOpen(true))} data-testid="request-return">
            Request a return
          </Button>
        </>
      ) : eligibility?.reason ? (
        <p className="mt-4 text-[13px] text-muted">{eligibility.reason}</p>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Request a return"
        description="Choose the items and tell us what went wrong. We review requests within one working day."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button onClick={submit} loading={busy}>
              Send request
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Items</legend>
            <ul className="divide-y divide-line border border-line">
              {items.map((item) => {
                const max = eligibility?.remaining[item.id] ?? 0;
                const q = quantities[item.id] ?? 0;
                return (
                  <li key={item.id} className={cn('flex items-center gap-3 px-3 py-3', max === 0 && 'opacity-50')}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px]">{item.productName}</p>
                      <p className="text-[12px] text-muted">{[item.variantLabel, max === 0 ? 'Already returned' : `Up to ${max}`].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex items-center border border-line">
                      <button type="button" className="flex h-8 w-8 items-center justify-center disabled:opacity-30" onClick={() => setQty(item.id, q - 1)} disabled={q === 0} aria-label={`Fewer ${item.productName}`}>
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-7 text-center text-[13px] tabular-nums" aria-live="polite">
                        {q}
                      </span>
                      <button type="button" className="flex h-8 w-8 items-center justify-center disabled:opacity-30" onClick={() => setQty(item.id, q + 1)} disabled={q >= max} aria-label={`More ${item.productName}`}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {errors.items ? <p className="mt-1.5 text-[12.5px] text-danger">{errors.items}</p> : null}
          </fieldset>
          <Field label="Reason" required error={errors.reason}>
            {(p) => (
              <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
                <option value="">Choose a reason</option>
                {RETURN_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {RETURN_REASON_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Anything else we should know?" error={errors.note}>
            {(p) => <Textarea {...p} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <Alert tone="info">Please keep the items unworn with their tags. Once approved, we’ll send you the return instructions.</Alert>
        </div>
      </Dialog>
    </div>
  );
}
