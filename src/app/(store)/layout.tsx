import { SiteFooter } from '@/components/store/site-footer';
import { SiteHeader } from '@/components/store/site-header';
import { StoreProvider } from '@/components/store/store-provider';
import { getStoreShell } from '@/server/queries/store-shell';

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const shell = await getStoreShell();
  const { store, checkout, announcement } = shell.settings;

  return (
    <StoreProvider
      user={shell.user ? { id: shell.user.id, name: shell.user.name, email: shell.user.email, role: shell.user.role } : null}
      initialCartCount={shell.cartCount}
      initialWishlistIds={shell.wishlistIds}
      freeShippingThreshold={checkout.freeShippingThreshold}
    >
      <a href="#main" className="sr-only z-[60] bg-ink px-4 py-2 text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      {shell.demo ? (
        <div className="bg-[#f3ead9] text-gold-deep" data-testid="demo-notice">
          <p className="container-x py-2 text-center text-[11.5px] leading-snug">
            <span className="font-medium uppercase tracking-[0.14em]">Demo store</span>
            <span className="mx-2 opacity-50">·</span>
            Products, AI-generated photos, customers and orders are sample data. No real payments are taken.
          </p>
        </div>
      ) : null}
      {announcement.enabled && announcement.message ? (
        <div className="bg-ink text-paper">
          <p className="container-x py-2.5 text-center text-[11px] uppercase tracking-[0.2em] text-paper/85">{announcement.message}</p>
        </div>
      ) : null}
      <SiteHeader categories={shell.navCategories} collections={shell.collections} />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <SiteFooter
        categories={shell.navCategories}
        storeName={store.storeName}
        tagline={store.tagline}
        supportEmail={store.supportEmail}
        supportPhone={store.supportPhone}
        address={store.address}
        onlinePayments={shell.onlinePayments}
      />
    </StoreProvider>
  );
}
