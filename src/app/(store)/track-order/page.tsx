import type { Metadata } from 'next';
import { TrackOrderForm } from '@/components/store/track-order-form';

export const metadata: Metadata = { title: 'Track your order' };

export default async function TrackOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <div className="container-x max-w-3xl pt-14">
      <p className="eyebrow text-gold-deep">Order tracking</p>
      <h1 className="mt-3 font-display text-[46px] font-light leading-none md:text-[58px]">Where is my order?</h1>
      <p className="mt-4 max-w-lg text-[15px] text-muted">
        Enter the order number from your confirmation and the mobile number you used at checkout.
      </p>
      <TrackOrderForm initialOrderNumber={typeof sp.order === 'string' ? sp.order : ''} />
    </div>
  );
}
