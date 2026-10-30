import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/feedback';
import { RichText } from '@/components/ui/misc';
import { getSettings } from '@/server/services/settings';

const POLICIES = {
  shipping: 'Delivery & charges',
  returns: 'Returns & exchanges',
  privacy: 'Privacy policy',
  terms: 'Terms of service',
} as const;
type PolicyKey = keyof typeof POLICIES;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: POLICIES[slug as PolicyKey] ?? 'Policy' };
}

export default async function PolicyPage({ params }: Props) {
  const { slug } = await params;
  if (!(slug in POLICIES)) notFound();
  const { policies, store } = await getSettings(['policies', 'store']);
  const key = slug as PolicyKey;
  return (
    <article className="container-x max-w-3xl pt-14">
      <p className="eyebrow text-gold-deep">Customer care</p>
      <h1 className="mt-3 font-display text-[46px] font-light leading-none md:text-[58px]">{POLICIES[key]}</h1>
      <div className="rule-gold my-10 w-24" />
      {!policies.reviewed[key] ? (
        <Alert tone="warning" className="mb-8" title="Draft policy">
          This text is a template that has not yet been reviewed and confirmed by {store.legalName || store.storeName}. It is not legal advice. Contact customer
          care if you have questions about how it applies to your order.
        </Alert>
      ) : null}
      <RichText text={policies[key]} />
    </article>
  );
}
