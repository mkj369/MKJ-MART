import Link from 'next/link';
import { Badge, type BadgeTone } from '@/components/ui/feedback';
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type OrderStatus,
  type PaymentStatus,
} from '@/lib/order-status';
import { RETURN_STATUS_LABEL, type ReturnStatus } from '@/lib/returns';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-3 inline-block text-[12.5px] text-muted hover:text-ink">
            ← {back.label}
          </Link>
        ) : null}
        <h1 className="font-display text-[34px] font-normal leading-none md:text-[40px]">{title}</h1>
        {description ? <p className="mt-2 text-[14px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, actions, children, className, bodyClassName }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('border border-line bg-paper', className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          {title ? <h2 className="text-[11px] font-medium uppercase tracking-[0.16em]">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto border border-line bg-paper', className)}>
      <table className="w-full min-w-[720px] border-collapse text-left text-[13.5px]">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('border-b border-line bg-bone/70 px-4 py-3 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted', className)}>{children}</th>;
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('border-b border-line px-4 py-3 align-middle', className)}>{children}</td>;
}

const ORDER_TONE: Record<OrderStatus, BadgeTone> = {
  pending: 'warning',
  confirmed: 'info',
  processing: 'info',
  shipped: 'gold',
  delivered: 'success',
  cancelled: 'danger',
  returned: 'neutral',
};
const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  unpaid: 'neutral',
  pending: 'warning',
  paid: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  refunded: 'info',
  partially_refunded: 'info',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONE[status]}>{PAYMENT_STATUS_LABEL[status]}</Badge>;
}

export function ProductStatusBadge({ status }: { status: 'draft' | 'active' | 'archived' }) {
  return <Badge tone={status === 'active' ? 'success' : status === 'draft' ? 'warning' : 'neutral'}>{status}</Badge>;
}

/** Link-based tabs (state lives in the URL). */
export function Tabs({ items }: { items: { href: string; label: string; count?: number; active: boolean }[] }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto scrollbar-none border-b border-line">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors',
            t.active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="rounded-full bg-bone px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export function StatCard({ label, value, hint, change }: { label: string; value: React.ReactNode; hint?: React.ReactNode; change?: number | null }) {
  return (
    <div className="border border-line bg-paper p-5">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-3 font-display text-[32px] leading-none tabular-nums">{value}</p>
      <div className="mt-3 flex items-center gap-2 text-[12px]">
        {change !== undefined ? (
          change === null ? (
            <span className="text-muted">No data for the previous period</span>
          ) : (
            <span className={cn(change > 0 ? 'text-success' : change < 0 ? 'text-danger' : 'text-muted')}>
              {change > 0 ? '▲' : change < 0 ? '▼' : '—'} {Math.abs(change)}%
            </span>
          )
        ) : null}
        {hint && change !== null ? <span className="text-muted">{hint}</span> : null}
      </div>
    </div>
  );
}

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  const tone = status === 'requested' ? 'warning' : status === 'approved' || status === 'received' ? 'info' : status === 'refunded' ? 'success' : 'neutral';
  return <Badge tone={tone}>{RETURN_STATUS_LABEL[status]}</Badge>;
}
