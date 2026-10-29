import { NextResponse, type NextRequest } from 'next/server';
import { cronSecret } from '@/server/env';
import { runJob } from '@/server/jobs';
import { expireStalePayments } from '@/server/services/payments';
import { authorizeCron } from '../authorize';

export const dynamic = 'force-dynamic';

/**
 * Reconciles and cancels online-payment orders whose payment window elapsed (releases reserved
 * stock). Before cancelling, each transaction is checked with the gateway's Transaction Query API so
 * a payment whose IPN was missed is recorded as paid instead of cancelled. Run every 5 minutes.
 */
export async function POST(req: NextRequest) {
  const denied = authorizeCron(req, cronSecret());
  if (denied) return denied;
  const result = await runJob('expire-payments', () => expireStalePayments());
  return NextResponse.json({ data: result });
}
