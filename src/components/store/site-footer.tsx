import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import type { NavCategory } from './site-header';

export function SiteFooter({
  categories,
  storeName,
  tagline,
  supportEmail,
  supportPhone,
  address,
  onlinePayments,
}: {
  categories: NavCategory[];
  storeName: string;
  tagline: string;
  supportEmail: string;
  supportPhone: string;
  address: string;
  onlinePayments: boolean;
}) {
  const year = new Date().getFullYear();
  const methods = ['Cash on Delivery', ...(onlinePayments ? ['bKash', 'Nagad', 'Rocket', 'Visa', 'Mastercard', 'Amex'] : [])];
  return (
    <footer className="mt-24 bg-ink text-paper">
      <div className="container-x grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:py-20">
        <div className="max-w-sm">
          <Logo inverted className="items-start [&>span:first-child]:[margin-right:0]" />
          <p className="mt-6 font-display text-[22px] leading-snug text-paper/90">{tagline}</p>
          <div className="mt-6 space-y-1.5 text-[13.5px] text-paper/65">
            {supportEmail ? (
              <p>
                <a href={`mailto:${supportEmail}`} className="transition-colors hover:text-paper">
                  {supportEmail}
                </a>
              </p>
            ) : null}
            {supportPhone ? <p>{supportPhone}</p> : null}
            {address ? <p>{address}</p> : null}
          </div>
        </div>
        <FooterColumn
          title="Shop"
          links={[{ label: 'All products', href: '/shop' }, ...categories.map((c) => ({ label: c.name, href: `/shop?category=${c.slug}` })), { label: 'New arrivals', href: '/shop?sort=newest' }]}
        />
        <FooterColumn
          title="Help"
          links={[
            { label: 'Track your order', href: '/track-order' },
            { label: 'Delivery & charges', href: '/policies/shipping' },
            { label: 'Returns & exchanges', href: '/policies/returns' },
            { label: 'My account', href: '/account' },
          ]}
        />
        <FooterColumn
          title="Legal"
          links={[
            { label: 'Privacy policy', href: '/policies/privacy' },
            { label: 'Terms of service', href: '/policies/terms' },
          ]}
        />
      </div>
      <div className="border-t border-paper/10">
        <div className="container-x flex flex-col gap-5 py-7 text-[12px] text-paper/55 lg:flex-row lg:items-center lg:justify-between">
          <p>
            © {year} {storeName}. Part of the <span className="text-gold-light">MKJ Ecosystem</span>. All prices in BDT (৳), VAT included.
          </p>
          <ul className="flex flex-wrap gap-2" aria-label="Accepted payment methods">
            {methods.map((m) => (
              <li key={m} className="border border-paper/15 px-2.5 py-1 text-[10.5px] uppercase tracking-[0.12em] text-paper/70">
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h2 className="eyebrow text-gold-light">{title}</h2>
      <ul className="mt-5 space-y-2.5 text-[14px] text-paper/75">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} className="transition-colors hover:text-paper">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
