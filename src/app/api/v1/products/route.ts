import { route } from '@/server/http/api';
import { listProducts } from '@/server/services/catalog';
import { parseProductQuery } from '@/lib/validation/store';

/** GET /api/v1/products?q=&category=&collection=&size=&color=&minPrice=&maxPrice=&inStock=1&onSale=1&sort=&page=&pageSize= */
export const GET = route(async (ctx) => listProducts(parseProductQuery(ctx.req.nextUrl.searchParams)));
