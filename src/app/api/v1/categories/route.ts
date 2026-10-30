import { route } from '@/server/http/api';
import { getCatalogFacets, getCategoryTree, getCollections } from '@/server/services/catalog';

export const GET = route(async () => {
  const [categories, collections, facets] = await Promise.all([getCategoryTree(), getCollections(), getCatalogFacets()]);
  return { categories, collections, facets };
});
