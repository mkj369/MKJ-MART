'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api-client';
import type { CartView } from '@/server/services/cart';
import { useStore } from './store-provider';

export function OrderActions({
  orderNumber,
  token,
  canCancel,
  canRestore,
}: {
  orderNumber: string;
  token: string | null;
  canCancel: boolean;
  canRestore: boolean;
}) {
  const router = useRouter();
  const { setCartCount, openCart } = useStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canCancel && !canRestore) return null;

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
