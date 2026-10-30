import { z } from 'zod';
import { notFound } from '@/server/errors';
import { route } from '@/server/http/api';
import { readOrderToken } from '@/server/http/helpers';
import { withdrawReturnRequest } from '@/server/services/returns';

export const POST = route<{ orderNumber: string; requestNumber: string }>(async (ctx) => {
  const body = await ctx.body(z.object({ token: z.string().max(200).optional() }));
  const requestNumber = ctx.params.requestNumber.toUpperCase();
  if (!/^RT-[A-Z0-9]{4,12}$/.test(requestNumber)) throw notFound('Return request not found.');
  await withdrawReturnRequest(ctx.params.orderNumber.toUpperCase(), requestNumber, { userId: ctx.user?.id, token: readOrderToken(ctx, body) });
  return { ok: true };
});
