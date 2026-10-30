import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, MessageCircle, Phone, Clock, MapPin } from 'lucide-react';
import { RichText } from '@/components/ui/misc';
import { SupportForm } from '@/components/store/support-form';
import { getCurrentUser } from '@/server/auth/current-user';
import { getSettings } from '@/server/services/settings';
import { formatBdPhone } from '@/lib/phone';

export const metadata: Metadata = { title: 'Help & contact', description: 'Order help, delivery, returns and how to reach customer care.' };

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, user, settings] = await Promise.all([searchParams, getCurrentUser(), getSettings(['store', 'support', 'returns'])]);
  const { store, support, returns } = settings;
  const orderNumber = typeof sp.order === 'string' && /^[A-Za-z0-9-]{6,32}$/.test(sp.order) ? sp.order.toUpperCase() : '';
  const channels = [
    store.supportPhone ? { icon: Phone, label: 'Call us', value: formatBdPhone(store.supportPhone), href: `tel:${store.supportPhone}` } : null,
    store.whatsappNumber ? { icon: MessageCircle, label: 'WhatsApp', value: formatBdPhone(store.whatsappNumber), href: `https://wa.me/88${store.whatsappNumber}` } : null,
    store.supportEmail ? { icon: Mail, label: 'Email', value: store.supportEmail, href: `mailto:${store.supportEmail}` } : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <div className="container-x max-w-6xl pt-14">
      <p className="eyebrow text-gold-deep">Customer care</p>
      <h1 className="mt-3 font-display text-[46px] font-light leading-none md:text-[58px]">Help &amp; contact</h1>
      <p className="mt-5 max-w-2xl text-[15px] text-muted">
        Most answers are a click away: track a parcel, start a return from your order page, or read our delivery and returns policies.
        {support.responseTime ? ` If you need us, we reply ${support.responseTime}.` : ''}
      </p>

      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: '/track-order', title: 'Track an order', text: 'With your order number and phone.' },
          { href: user ? '/account/orders' : '/login?next=/account/orders', title: 'Your orders', text: 'Returns start from the order page.' },
          { href: '/policies/shipping', title: 'Delivery & charges', text: 'Areas, fees and timelines.' },
          { href: '/policies/returns', title: 'Returns & exchanges', text: `${returns.enabled ? `${returns.windowDays}-day` : 'Our'} return policy.` },
        ].map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block h-full border border-line p-5 transition-colors hover:border-ink">
              <p className="font-medium">{l.title}</p>
              <p className="mt-1 text-[13px] text-muted">{l.text}</p>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-16 grid gap-14 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="eyebrow border-b border-line pb-3">
            Send us a message
          </h2>
          <div className="mt-6">
            {support.contactFormEnabled ? (
              <SupportForm defaults={{ name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', orderNumber }} />
            ) : (
              <p className="text-[14px] text-muted">The contact form is currently unavailable. Please use the contact details on this page.</p>
            )}
          </div>
        </section>
        <aside className="space-y-8">
          {channels.length || store.supportHours || store.address ? (
            <div className="border border-line bg-bone p-6">
              <h2 className="eyebrow">Reach us directly</h2>
              <ul className="mt-5 space-y-4 text-[14px]">
                {channels.map(({ icon: Icon, label, value, href }) => (
                  <li key={label} className="flex gap-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" strokeWidth={1.5} aria-hidden="true" />
                    <span>
                      <span className="block text-[12px] uppercase tracking-[0.12em] text-muted">{label}</span>
                      <a href={href} className="underline-offset-4 hover:underline" {...(href.startsWith('https') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                        {value}
                      </a>
                    </span>
                  </li>
                ))}
                {store.supportHours ? (
                  <li className="flex gap-3">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" strokeWidth={1.5} aria-hidden="true" />
                    <span>
                      <span className="block text-[12px] uppercase tracking-[0.12em] text-muted">Hours</span>
                      {store.supportHours}
                    </span>
                  </li>
                ) : null}
                {store.address ? (
                  <li className="flex gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" strokeWidth={1.5} aria-hidden="true" />
                    <span>
                      <span className="block text-[12px] uppercase tracking-[0.12em] text-muted">Address</span>
                      {store.address}
                    </span>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
          {support.faq.trim() ? (
            <section aria-labelledby="faq-heading">
              <h2 id="faq-heading" className="eyebrow border-b border-line pb-3">
                Frequently asked
              </h2>
              <div className="mt-2 [&_h3]:mt-6 [&_h3]:text-[18px]">
                <RichText text={support.faq} headingAs="h3" />
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
