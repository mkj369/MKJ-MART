import { route } from '@/server/http/api';
import { currentCartId } from '@/server/http/helpers';
import { getCartView } from '@/server/services/cart';

export const GET = route(async (ctx) => getCartView(await currentCartId(ctx)));
