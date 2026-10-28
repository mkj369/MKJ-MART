import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/misc';
import { requireCustomerPage } from '@/server/auth/current-user';
import { listOrdersForUser } from '@/server/services/orders';
import { formatBDT } from '@/lib/money';
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/order-status';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'My orders' };

export default async function AccountOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCustomerPage('/account/orders');
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === 'string' ? sp.page : 1) || 1);
  const result = await listOrdersForUser(user.id, page, 10);
  const totalPages = Math.ceil(result.total / result.pageSize);

  if (!result.items.length) {
    return (
      <EmptyState
        className="border border-line"
        icon={<Package className="h-6 w-6" strokeWidth={1.25} />}
        title="No orders yet"
        description="When you place an order, you can follow it here."
        action={
          <Link href="/shop" className={buttonClasses({ variant: 'primary' })}>
            Start shopping
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <h2 className="eyebrow border-b border-line pb-3">Order history ({result.total})</h2>
      <ul className="divide-y divide-line" data-testid="order-history">
        {result.items.map((o) => (
          <li key={o.id}>
            <Link href={`/orders/${o.orderNumber}`} className="flex items-center gap-5 py-5 transition-colors hover:bg-bone/60">
              <div className="relative h-[84px] w-[63px] shrink-0 bg-linen">
                {o.firstImage ? <Image src={o.firstImage} alt="" fill sizes="64px" className="object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{o.orderNumber}</p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {formatDate(o.placedAt)} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'} · {PAYMENT_STATUS_LABEL[o.paymentStatus]}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="tabular-nums">{formatBDT(o.total)}</span>
                <Badge tone={o.status === 'cancelled' ? 'danger' : o.status === 'delivered' ? 'success' : 'neutral'}>{ORDER_STATUS_LABEL[o.status]}</Badge>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Pagination className="mt-10" page={page} totalPages={totalPages} hrefFor={(p) => `/account/orders?page=${p}`} />
    </div>
  );
}
