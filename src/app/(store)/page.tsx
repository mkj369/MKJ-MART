import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Banknote, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { ProductGrid } from '@/components/store/product-card';
import { getCollections, getFeaturedProducts, listProducts } from '@/server/services/catalog';
import { getStoreShell } from '@/server/queries/store-shell';
import { parseProductQuery } from '@/lib/validation/store';
import { formatBDT } from '@/lib/money';

export default async function HomePage() {
  const [shell, newArrivals, bestsellers, featured, collections] = await Promise.all([
    getStoreShell(),
    listProducts({ ...parseProductQuery({}), sort: 'newest', pageSize: 4 }),
    listProducts({ ...parseProductQuery({}), sort: 'bestselling', pageSize: 4 }),
    getFeaturedProducts(4),
    getCollections({ featuredOnly: true }),
  ]);
  const freeThreshold = shell.settings.checkout.freeShippingThreshold;
  const liveCollections = collections.filter((c) => c.productCount > 0).slice(0, 3);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative" aria-labelledby="hero-title">
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-linen sm:aspect-[16/10] lg:aspect-auto lg:h-[min(88vh,860px)]">
          <Image
            src="/images/demo/editorial/hero-kahn.webp"
            alt="Two models in an ivory panjabi and a sage kurta beside monumental concrete architecture in Dhaka"
            fill
            priority
            sizes="100vw"
            className="animate-fade-in object-cover object-[78%_center] lg:object-center"
          />
          <div className="absolute inset-0 hidden bg-gradient-to-r from-[#efe9df]/85 via-[#efe9df]/30 to-transparent lg:block" />
        </div>
        <div className="container-x lg:absolute lg:inset-0 lg:flex lg:items-center">
          <div className="max-w-xl animate-fade-up py-10 lg:py-0">
            <p className="eyebrow text-gold-deep">Festive &amp; Winter 2026</p>
            <h1 id="hero-title" className="mt-5 font-display text-[52px] font-light leading-[0.95] tracking-[-0.01em] sm:text-[68px] lg:text-[88px]">
              Quiet luxury, <em className="font-normal">cut in Dhaka.</em>
            </h1>
            <p className="mt-6 max-w-md text-[15.5px] leading-relaxed text-ink/75">
              Panjabis, shirting and leather goods designed to be worn for years — delivered to all 64 districts, with cash on delivery.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
              <Link href="/shop" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
                Shop the collection
              </Link>
              {liveCollections[0] ? (
                <Link href={`/collections/${liveCollections[0].slug}`} className="group eyebrow inline-flex items-center gap-2 border-b border-ink pb-1">
                  Explore {liveCollections[0].name}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* ── Service promises ────────────────────────────────────────────── */}
      <section aria-label="Our promises" className="border-y border-line">
        <ul className="container-x grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
          {[
            { Icon: Banknote, title: 'Cash on Delivery', text: 'Pay when it arrives, anywhere in Bangladesh' },
            { Icon: Truck, title: freeThreshold ? `Free delivery over ${formatBDT(freeThreshold)}` : 'Nationwide delivery', text: 'Dhaka in 1–2 days, all 64 districts' },
            { Icon: RotateCcw, title: '7-day returns', text: 'Easy exchanges on unworn pieces' },
            { Icon: ShieldCheck, title: shell.onlinePayments ? 'Secure online payment' : 'Verified orders', text: shell.onlinePayments ? 'bKash, Nagad, cards via SSLCommerz' : 'Every order confirmed by phone' },
          ].map(({ Icon, title, text }) => (
            <li key={title} className="flex items-start gap-4 px-2 py-7 lg:px-8">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold-deep" strokeWidth={1.3} />
              <div>
                <p className="text-[13.5px] font-medium">{title}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Collections ─────────────────────────────────────────────────── */}
      {liveCollections.length ? (
        <section className="container-x pt-24" aria-labelledby="collections-title">
          <div className="mb-10 flex items-end justify-between gap-6">
            <div>
              <p className="eyebrow text-gold-deep">Curated</p>
              <h2 id="collections-title" className="mt-3 font-display text-[40px] font-light leading-none md:text-[52px]">
                The season&rsquo;s edits
              </h2>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3 md:gap-6">
            {liveCollections.map((col, i) => (
              <Link key={col.id} href={`/collections/${col.slug}`} className="group relative block overflow-hidden bg-linen">
                <div className="relative aspect-[4/5]">
                  {col.imageUrl ? (
                    <Image
                      src={col.imageUrl}
                      alt=""
                      fill
                      sizes="(min-width: 768px) 32vw, 100vw"
                      className="object-cover transition-transform duration-[1400ms] ease-[var(--ease-luxe)] group-hover:scale-[1.04]"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/65 via-ink/5 to-transparent" />
                </div>
                <div className="absolute inset-x-0 bottom-0 p-7 text-paper">
                  <p className="eyebrow text-paper/70">0{i + 1} — {col.productCount} pieces</p>
                  <h3 className="mt-2 font-display text-[34px] font-light leading-tight">{col.name}</h3>
                  <p className="mt-1 line-clamp-2 max-w-xs text-[13.5px] text-paper/80">{col.description}</p>
                  <span className="eyebrow mt-5 inline-flex items-center gap-2 border-b border-paper/60 pb-1">
                    Explore <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── New arrivals ────────────────────────────────────────────────── */}
      {newArrivals.items.length ? (
        <section className="container-x pt-24" aria-labelledby="new-title">
          <SectionHeader eyebrow="Just in" title="New arrivals" href="/shop?sort=newest" id="new-title" />
          <ProductGrid products={newArrivals.items} />
        </section>
      ) : null}

      {/* ── Editorial ───────────────────────────────────────────────────── */}
      <section className="mt-24 bg-bone" aria-labelledby="story-title">
        <div className="container-x grid items-center gap-10 py-16 md:grid-cols-2 md:gap-16 lg:py-24">
          <div className="relative aspect-[7/8] overflow-hidden bg-linen">
            <Image src="/images/demo/editorial/concrete-circle.webp" alt="Sunlit concrete wall with a circular opening" fill sizes="(min-width: 768px) 45vw, 100vw" className="object-cover" />
          </div>
          <div className="max-w-lg">
            <p className="eyebrow text-gold-deep">Our approach</p>
            <h2 id="story-title" className="mt-4 font-display text-[40px] font-light leading-[1.05] md:text-[54px]">
              Fewer, better pieces — <em>made to stay.</em>
            </h2>
            <div className="rule-gold my-8 w-24" />
            <p className="text-[15.5px] leading-[1.8] text-ink/75">
              We design for the way Bangladesh dresses: breathable cottons and linens for long humid summers, silk and zari for
              Eid and wedding season, soft wool layers for cool December evenings.
            </p>
            <p className="mt-4 text-[15.5px] leading-[1.8] text-ink/75">
              Honest fabrics, clean finishing and proportions that do not date — so each piece earns its place in your wardrobe.
            </p>
            <Link href="/shop" className={buttonClasses({ variant: 'secondary', className: 'mt-10' })}>
              Discover the collection
            </Link>
          </div>
        </div>
      </section>

      {/* ── Featured / bestsellers ──────────────────────────────────────── */}
      {featured.length ? (
        <section className="container-x pt-24" aria-labelledby="featured-title">
          <SectionHeader eyebrow="Signature pieces" title="The MKJ edit" href="/shop" id="featured-title" />
          <ProductGrid products={featured} />
        </section>
      ) : null}
      {bestsellers.items.length ? (
        <section className="container-x pt-24" aria-labelledby="best-title">
          <SectionHeader eyebrow="Most loved" title="Bestsellers" href="/shop?sort=bestselling" id="best-title" />
          <ProductGrid products={bestsellers.items} />
        </section>
      ) : null}

      {/* ── COD / tracking band ─────────────────────────────────────────── */}
      <section className="container-x pt-24" aria-labelledby="cod-title">
        <div className="flex flex-col items-start justify-between gap-8 border border-line px-8 py-12 md:flex-row md:items-center md:px-14">
          <div>
            <p className="eyebrow text-gold-deep">Shop with confidence</p>
            <h2 id="cod-title" className="mt-3 font-display text-[34px] font-light leading-tight md:text-[42px]">
              Pay when it arrives — in all 64 districts.
            </h2>
            <p className="mt-2 text-[14.5px] text-muted">Placed an order? Follow it from packing to your doorstep.</p>
          </div>
          <Link href="/track-order" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
            Track your order
          </Link>
        </div>
      </section>
    </>
  );
}

function SectionHeader({ eyebrow, title, href, id }: { eyebrow: string; title: string; href: string; id: string }) {
  return (
    <div className="mb-10 flex items-end justify-between gap-6">
      <div>
        <p className="eyebrow text-gold-deep">{eyebrow}</p>
        <h2 id={id} className="mt-3 font-display text-[40px] font-light leading-none md:text-[52px]">
          {title}
        </h2>
      </div>
      <Link href={href} className="group eyebrow hidden shrink-0 items-center gap-2 border-b border-ink pb-1 sm:inline-flex">
        View all <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
      </Link>
    </div>
  );
}
