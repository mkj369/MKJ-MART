import { Check } from 'lucide-react';
import { FULFILMENT_STEPS, ORDER_STATUS_LABEL, type OrderStatus } from '@/lib/order-status';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export function OrderProgress({ status }: { status: OrderStatus }) {
  if (status === 'cancelled' || status === 'returned') {
    return (
      <div className="border border-line bg-bone px-5 py-4 text-[14px]">
        This order was <span className="font-medium">{ORDER_STATUS_LABEL[status].toLowerCase()}</span>.
      </div>
    );
  }
  const current = FULFILMENT_STEPS.indexOf(status);
  return (
    <ol className="grid grid-cols-5" aria-label="Order progress">
      {FULFILMENT_STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <li key={step} className="relative flex flex-col items-center text-center">
            {i > 0 ? <span className={cn('absolute right-1/2 top-[13px] h-px w-full', i <= current ? 'bg-ink' : 'bg-line-strong')} aria-hidden="true" /> : null}
            <span
              className={cn(
                'relative z-10 flex h-[27px] w-[27px] items-center justify-center rounded-full border text-[11px]',
                done ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-paper text-muted',
                i === current && 'ring-4 ring-gold-light/50',
              )}
              aria-current={i === current ? 'step' : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : i + 1}
            </span>
            <span className={cn('mt-2.5 text-[10.5px] uppercase tracking-[0.12em] sm:text-[11px]', done ? 'text-ink' : 'text-muted')}>
              {ORDER_STATUS_LABEL[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderEvents({ events }: { events: { id: string; message: string; createdAt: Date | string }[] }) {
  if (!events.length) return null;
  return (
    <ol className="space-y-5 border-l border-line pl-6">
      {[...events].reverse().map((e, i) => (
        <li key={e.id} className="relative">
          <span className={cn('absolute -left-[29px] top-1.5 h-2 w-2 rounded-full', i === 0 ? 'bg-gold' : 'bg-line-strong')} aria-hidden="true" />
          <p className="text-[14px]">{e.message}</p>
          <p className="mt-0.5 text-[12px] text-muted">{formatDateTime(e.createdAt)}</p>
        </li>
      ))}
    </ol>
  );
}
