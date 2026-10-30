'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Minus, Plus, X } from 'lucide-react';
import type { CartLine } from '@/server/services/cart';
import { formatBDT } from '@/lib/money';
import { cn } from '@/lib/utils';

const ISSUE_TEXT: Record<NonNullable<CartLine['issue']>, string> = {
  unavailable: 'No longer available — please remove it.',
  out_of_stock: 'Sold out — please remove it.',
  insufficient_stock: 'Only a few left — reduce the quantity.',
};

/** Shared cart line list used by the drawer and the bag page. */
export function CartLines({
  lines,
  busyId,
  onQuantity,
  onRemove,
  compact = false,
}: {
  lines: CartLine[];
  busyId: string | null;
  onQuantity: (line: CartLine, quantity: number) => void;
  onRemove: (line: CartLine) => void;
  compact?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {lines.map((line) => {
        const busy = busyId === line.id;
        const variant = [line.colorName, line.sizeLabel].filter(Boolean).join(' · ');
        return (
          <li key={line.id} className={cn('flex gap-4 py-5', busy && 'opacity-60', compact ? 'px-6' : '')}>
            <Link
              href={`/products/${line.productSlug}`}
              className={cn('relative shrink-0 overflow-hidden bg-linen', compact ? 'h-[104px] w-[78px]' : 'h-[140px] w-[105px]')}
            >
              {line.image ? (
                <Image src={line.image} alt={line.productName} fill sizes="110px" className="object-cover" />
              ) : null}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/products/${line.productSlug}`} className="line-clamp-2 text-[14.5px] leading-snug hover:underline">
                    {line.productName}
                  </Link>
                  {variant ? <p className="mt-1 text-[12.5px] text-muted">{variant}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(line)}
                  disabled={busy}
                  className="-mr-1 -mt-1 p-1 text-muted transition-colors hover:text-ink"
                  aria-label={`Remove ${line.productName}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {line.issue ? <p className="mt-1.5 text-[12.5px] text-danger">{ISSUE_TEXT[line.issue]}</p> : null}
              <div className="mt-auto flex items-end justify-between pt-3">
                <div className="flex h-9 items-center border border-line-strong" role="group" aria-label="Quantity">
                  <button
                    type="button"
                    className="flex h-full w-9 items-center justify-center text-muted transition-colors hover:text-ink disabled:opacity-30"
                    onClick={() => onQuantity(line, line.quantity - 1)}
                    disabled={busy || line.quantity <= 1}
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    className="flex h-full w-9 items-center justify-center text-muted transition-colors hover:text-ink disabled:opacity-30"
                    onClick={() => onQuantity(line, line.quantity + 1)}
                    disabled={busy || line.quantity >= line.stock || line.issue === 'unavailable'}
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="text-right">
                  <p className="text-[14.5px] font-medium tabular-nums">{formatBDT(line.lineTotal)}</p>
                  {line.quantity > 1 ? <p className="text-[12px] text-muted tabular-nums">{formatBDT(line.unitPrice)} each</p> : null}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "Spend ৳X more for free delivery" progress indicator. */
export function FreeShippingMeter({ subtotal, threshold }: { subtotal: number; threshold: number | null }) {
  if (!threshold) return null;
  const remaining = Math.max(0, threshold - subtotal);
  const progress = Math.min(100, Math.round((subtotal / threshold) * 100));
  return (
    <div>
      <p className="text-[13px] text-ink/85">
        {remaining === 0 ? (
          <>You&rsquo;ve unlocked <span className="font-medium">free delivery</span>.</>
        ) : (
          <>
            Add <span className="font-medium tabular-nums">{formatBDT(remaining)}</span> more for free delivery.
          </>
        )}
      </p>
      <div className="mt-2 h-[3px] w-full bg-line" aria-hidden="true">
        <div className="h-full bg-gold transition-[width] duration-700 ease-[var(--ease-luxe)]" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
