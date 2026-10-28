import { NextResponse, type NextRequest } from 'next/server';
import { cronSecret } from '@/server/env';
import { expireStalePayments } from '@/server/services/payments';
import { authorizeCron } from '../authorize';

export const dynamic = 'force-dynamic';

/** Cancels online-payment orders whose payment window elapsed (releases reserved stock). */
export async function POST(req: NextRequest) {
  const denied = authorizeCron(req, cronSecret());
  if (denied) return denied;
  const expired = await expireStalePayments();
  return NextResponse.json({ data: { expired } });
}
