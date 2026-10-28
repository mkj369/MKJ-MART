import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@/server/env';
import { processSslcommerzCallback } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

const KINDS = new Set(['success', 'fail', 'cancel', 'ipn']);

async function readPayload(req: NextRequest): Promise<Record<string, string>> {
  const payload: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    payload[key] = value;
  });
  if (req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    form?.forEach((value, key) => {
      if (typeof value === 'string') payload[key] = value;
    });
  }
  return payload;
}

/**
 * SSLCommerz callbacks. These are cross-site POSTs by design (from the gateway / customer's browser),
 * so they bypass the CSRF check — but nothing here trusts the posted data: the outcome is decided by
 * the server-to-server Validation API inside processSslcommerzCallback.
 */
async function handle(req: NextRequest, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!KINDS.has(kind)) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });
  const payload = await readPayload(req);
  const result = await processSslcommerzCallback(kind as 'success' | 'fail' | 'cancel' | 'ipn', payload).catch((error) => {
    console.error('[payments] callback error', error);
    return { outcome: 'pending' as const, orderNumber: null, accessToken: null };
  });

  if (kind === 'ipn') return NextResponse.json({ received: true, outcome: result.outcome });

  const base = appUrl();
  if (!result.orderNumber) return NextResponse.redirect(`${base}/cart?payment=unknown`, 303);
  const target = new URL(`${base}/orders/${encodeURIComponent(result.orderNumber)}`);
  target.searchParams.set('payment', result.outcome);
  if (result.accessToken) target.searchParams.set('token', result.accessToken);
  return NextResponse.redirect(target, 303);
}

export const POST = handle;
export const GET = handle;
