import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/feedback';
import { ProfileForm } from '@/components/store/account-forms';
import { requireCustomerPage } from '@/server/auth/current-user';
import { getProfile } from '@/server/services/account';
import { listOrdersForUser } from '@/server/services/orders';
import { formatBDT } from '@/lib/money';
import { ORDER_STATUS_LABEL } from '@/lib/order-status';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const user = await requireCustomerPage('/account');
  const [profile, recent] = await Promise.all([getProfile(user.id), listOrdersForUser(user.id, 1, 3)]);
  return (
    <div className="space-y-14">
      <section>
        <h2 className="eyebrow border-b border-line pb-3">Profile</h2>
        <p className="mt-5 text-[13.5px] text-muted">
          Signed in as <span className="text-ink">{profile.email}</span> · Member since {formatDate(profile.createdAt)}
        </p>
        <div className="mt-6 max-w-xl">
          <ProfileForm initial={{ name: profile.name, phone: profile.phone ?? '' }} />
        </div>
      </section>
      <section>
        <div className="flex items-center justify-between border-b border-line pb-3">
          <h2 className="eyebrow">Recent orders</h2>
          <Link href="/account/orders" className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
            View all
          </Link>
        </div>
        {recent.items.length ? (
          <ul className="divide-y divide-line">
            {recent.items.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.orderNumber}`} className="flex items-center justify-between gap-4 py-4 hover:bg-bone/60">
                  <div>
                    <p className="font-medium">{o.orderNumber}</p>
                    <p className="text-[13px] text-muted">
                      {formatDate(o.placedAt)} · {o.itemCount} items
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge tone={o.status === 'cancelled' ? 'danger' : o.status === 'delivered' ? 'success' : 'neutral'}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    <span className="tabular-nums">{formatBDT(o.total)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-[14px] text-muted">
            No orders yet.{' '}
            <Link href="/shop" className="text-ink underline underline-offset-4">
              Start shopping
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
