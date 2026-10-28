'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Heart, Menu, Search, ShoppingBag, User } from 'lucide-react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Logo } from '@/components/brand/logo';
import { Sheet } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useStore } from './store-provider';

export type NavCategory = { name: string; slug: string; children: { name: string; slug: string }[] };
export type NavCollection = { name: string; slug: string; imageUrl: string | null };

export function SiteHeader({ categories, collections }: { categories: NavCategory[]; collections: NavCollection[] }) {
  const { user, cartCount, wishlistIds, openCart } = useStore();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);

  const accountHref = user ? (user.role === 'customer' ? '/account' : '/admin') : '/login';
  const iconBtn = 'relative flex h-10 w-10 items-center justify-center text-ink transition-opacity hover:opacity-60';

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b bg-paper/95 backdrop-blur-md transition-[border-color,box-shadow] duration-300',
        scrolled ? 'border-line shadow-[0_1px_0_rgba(0,0,0,0.02)]' : 'border-transparent',
      )}
    >
      <div className="container-x grid h-[72px] grid-cols-[1fr_auto_1fr] items-center lg:h-[84px]">
        {/* Left: desktop navigation / mobile menu */}
        <div className="flex items-center">
          <button type="button" className={cn(iconBtn, '-ml-2 lg:hidden')} onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="h-[21px] w-[21px]" strokeWidth={1.4} />
          </button>
          <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
            <Link href="/shop" className="eyebrow py-2 transition-colors hover:text-gold-deep">
              Shop all
            </Link>
            {categories.map((cat) => (
              <div key={cat.slug} className="group relative">
                <Link
                  href={`/shop?category=${cat.slug}`}
                  className="eyebrow block py-8 transition-colors hover:text-gold-deep"
                  aria-haspopup={cat.children.length ? 'true' : undefined}
                >
                  {cat.name}
                </Link>
                {cat.children.length ? (
                  <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 translate-y-1 border border-line bg-paper px-8 py-7 opacity-0 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.25)] transition-all duration-300 ease-[var(--ease-luxe)] group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                    <p className="eyebrow mb-4 text-muted">{cat.name}</p>
                    <ul className="min-w-[200px] space-y-2.5">
                      {cat.children.map((child) => (
                        <li key={child.slug}>
                          <Link href={`/shop?category=${child.slug}`} className="font-display text-[19px] leading-tight transition-colors hover:text-gold-deep">
                            {child.name}
                          </Link>
                        </li>
                      ))}
                      <li className="pt-2">
                        <Link href={`/shop?category=${cat.slug}`} className="text-[12px] text-muted underline-offset-4 hover:text-ink hover:underline">
                          View all {cat.name.toLowerCase()}
                        </Link>
                      </li>
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
            {collections.length ? (
              <div className="group relative">
                <Link href={`/collections/${collections[0]!.slug}`} className="eyebrow block py-8 transition-colors hover:text-gold-deep" aria-haspopup="true">
                  Collections
                </Link>
                <div className="invisible absolute left-0 top-full z-50 flex translate-y-1 gap-5 border border-line bg-paper p-6 opacity-0 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.25)] transition-all duration-300 ease-[var(--ease-luxe)] group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                  {collections.slice(0, 3).map((col) => (
                    <Link key={col.slug} href={`/collections/${col.slug}`} className="group/col w-[150px]">
                      <div className="relative aspect-[3/4] overflow-hidden bg-linen">
                        {col.imageUrl ? (
                          <Image src={col.imageUrl} alt="" fill sizes="150px" className="object-cover transition-transform duration-700 ease-[var(--ease-luxe)] group-hover/col:scale-105" />
                        ) : null}
                      </div>
                      <p className="mt-3 font-display text-[17px] leading-tight">{col.name}</p>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </nav>
        </div>

        {/* Centre: wordmark */}
        <Link href="/" aria-label="MKJ Store — home" className="justify-self-center">
          <Logo />
        </Link>

        {/* Right: actions */}
        <div className="-mr-2 flex items-center justify-end gap-0.5 sm:gap-1">
          <button type="button" className={iconBtn} onClick={() => setSearchOpen(true)} aria-label="Search">
            <Search className="h-[19px] w-[19px]" strokeWidth={1.4} />
          </button>
          <Link href={accountHref} className={cn(iconBtn, 'hidden sm:flex')} aria-label={user ? 'Your account' : 'Sign in'}>
            <User className="h-[19px] w-[19px]" strokeWidth={1.4} />
          </Link>
          <Link href={user ? '/account/wishlist' : '/login?next=/account/wishlist'} className={cn(iconBtn, 'hidden sm:flex')} aria-label="Wishlist">
            <Heart className="h-[19px] w-[19px]" strokeWidth={1.4} />
            {wishlistIds.length ? <CountBadge count={wishlistIds.length} /> : null}
          </Link>
          <button type="button" className={iconBtn} onClick={openCart} aria-label={`Bag, ${cartCount} items`} data-testid="cart-button">
            <ShoppingBag className="h-[19px] w-[19px]" strokeWidth={1.4} />
            {cartCount ? <CountBadge count={cartCount} /> : null}
          </button>
        </div>
      </div>

      <MobileMenu open={menuOpen} onOpenChange={setMenuOpen} categories={categories} collections={collections} signedIn={!!user} accountHref={accountHref} />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="absolute right-0.5 top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-ink px-1 text-[9.5px] font-medium tabular-nums text-paper" data-testid="cart-count">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function MobileMenu({
  open,
  onOpenChange,
  categories,
  collections,
  signedIn,
  accountHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: NavCategory[];
  collections: NavCollection[];
  signedIn: boolean;
  accountHref: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} side="left" title="Menu">
      <nav aria-label="Mobile" className="px-6 py-6">
        <ul className="space-y-1">
          <li>
            <Link href="/shop" className="block py-2.5 font-display text-[26px]">
              Shop all
            </Link>
          </li>
          {categories.map((cat) => (
            <li key={cat.slug}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between py-2.5 font-display text-[26px] [&::-webkit-details-marker]:hidden">
                  {cat.name}
                  <span className="text-xl text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <ul className="mb-3 space-y-2 border-l border-gold/50 pl-4">
                  {cat.children.map((child) => (
                    <li key={child.slug}>
                      <Link href={`/shop?category=${child.slug}`} className="block py-1 text-[15px] text-ink/80">
                        {child.name}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link href={`/shop?category=${cat.slug}`} className="block py-1 text-[13px] text-muted underline underline-offset-4">
                      View all
                    </Link>
                  </li>
                </ul>
              </details>
            </li>
          ))}
          {collections.map((col) => (
            <li key={col.slug}>
              <Link href={`/collections/${col.slug}`} className="block py-2 text-[15px] text-ink/80">
                {col.name}
              </Link>
            </li>
          ))}
        </ul>
        <div className="rule-gold my-8" />
        <ul className="space-y-3 text-[14px]">
          <li>
            <Link href={accountHref}>{signedIn ? 'My account' : 'Sign in / Register'}</Link>
          </li>
          <li>
            <Link href="/account/wishlist">Wishlist</Link>
          </li>
          <li>
            <Link href="/track-order">Track your order</Link>
          </li>
          <li>
            <Link href="/policies/shipping">Delivery & returns</Link>
          </li>
        </ul>
      </nav>
    </Sheet>
  );
}

function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const suggestions = ['Panjabi', 'Linen', 'Oxford shirt', 'Leather', 'Winter'];

  const go = (q: string) => {
    const term = q.trim();
    if (!term) return;
    onOpenChange(false);
    router.push(`/shop?q=${encodeURIComponent(term)}`);
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink/30 data-[state=open]:animate-fade-in" />
        <RadixDialog.Content
          className="fixed inset-x-0 top-0 z-50 bg-paper px-5 pb-10 pt-8 shadow-2xl focus:outline-none data-[state=open]:animate-fade-in md:px-8"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <RadixDialog.Title className="sr-only">Search the store</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Type a product, category or material and press enter.</RadixDialog.Description>
          <form
            className="mx-auto max-w-3xl"
            onSubmit={(e) => {
              e.preventDefault();
              go(query);
            }}
            role="search"
          >
            <div className="flex items-center gap-4 border-b border-ink pb-3">
              <Search className="h-5 w-5 shrink-0 text-muted" strokeWidth={1.4} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search panjabis, shirts, leather…"
                className="w-full bg-transparent font-display text-[28px] placeholder:text-faint focus:outline-none md:text-[34px]"
                aria-label="Search products"
                name="q"
              />
              <RadixDialog.Close className="eyebrow shrink-0 text-muted hover:text-ink">Close</RadixDialog.Close>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="eyebrow mr-2 text-muted">Popular</span>
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => go(s)} className="border border-line px-3 py-1.5 text-[13px] transition-colors hover:border-ink">
                  {s}
                </button>
              ))}
            </div>
          </form>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
