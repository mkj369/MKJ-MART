import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { getCurrentSession } from '@/server/auth/current-user';
import { guestCartIdFrom } from '@/server/auth/transport';
import { sslcommerzConfig } from '@/server/env';
import { findCartId, getCartCount } from '@/server/services/cart';
import { getCategoryTree, getCollections, hasDemoCatalog } from '@/server/services/catalog';
import { getSettings } from '@/server/services/settings';
import { getWishlistIds } from '@/server/services/wishlist';

/** Everything the storefront chrome needs, loaded once per request. */
export const getStoreShell = cache(async () => {
  const session = await getCurrentSession();
  const user = session?.user ?? null;
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const cartId = await findCartId({ userId: user?.id ?? null, guestCartId: guestCartIdFrom(cookieStore, requestHeaders) });

  const [cartCount, wishlistIds, tree, collections, settings, demo] = await Promise.all([
    getCartCount(cartId),
    user ? getWishlistIds(user.id) : Promise.resolve([]),
    getCategoryTree(),
    getCollections(),
    getSettings(['store', 'checkout', 'announcement']),
    hasDemoCatalog(),
  ]);

  const navCategories = tree
    .filter((c) => c.productCount > 0)
    .map((c) => ({
      name: c.name,
      slug: c.slug,
      children: c.children.filter((child) => child.productCount > 0).map((child) => ({ name: child.name, slug: child.slug })),
    }));

  return {
    user,
    cartCount,
    wishlistIds,
    navCategories,
    collections: collections
      .filter((c) => c.productCount > 0)
      .map((c) => ({ name: c.name, slug: c.slug, imageUrl: c.imageUrl })),
    settings,
    onlinePayments: settings.checkout.onlinePaymentEnabled && sslcommerzConfig() !== null,
    demo,
  };
});
