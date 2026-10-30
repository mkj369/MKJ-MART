import { route } from '@/server/http/api';
import { notFound } from '@/server/errors';
import { getProductBySlug, getRelatedProducts } from '@/server/services/catalog';

export const GET = route<{ slug: string }>(async (ctx) => {
  const product = await getProductBySlug(ctx.params.slug);
  if (!product) throw notFound('Product not found.');
  return { product, related: await getRelatedProducts(product) };
});
