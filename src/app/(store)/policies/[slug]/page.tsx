import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RichText } from '@/components/ui/misc';
import { getSetting } from '@/server/services/settings';

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
  const policies = await getSetting('policies');
  return (
    <article className="container-x max-w-3xl pt-14">
      <p className="eyebrow text-gold-deep">Customer care</p>
      <h1 className="mt-3 font-display text-[46px] font-light leading-none md:text-[58px]">{POLICIES[slug as PolicyKey]}</h1>
      <div className="rule-gold my-10 w-24" />
      <RichText text={policies[slug as PolicyKey]} />
    </article>
  );
}
