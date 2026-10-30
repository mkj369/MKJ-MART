import type { Metadata } from 'next';
import { WishlistGrid } from '@/components/store/wishlist-grid';
import { requireCustomerPage } from '@/server/auth/current-user';
import { getWishlist } from '@/server/services/wishlist';

export const metadata: Metadata = { title: 'My wishlist' };

export default async function WishlistPage() {
  const user = await requireCustomerPage('/account/wishlist');
  const products = await getWishlist(user.id);
  return <WishlistGrid products={products} />;
}
