import { NextResponse, type NextRequest } from 'next/server';
import { cronSecret } from '@/server/env';
import { runJob } from '@/server/jobs';
import { dispatchNotifications } from '@/server/notifications';
import { authorizeCron } from '../authorize';

export const dynamic = 'force-dynamic';

/** Delivers due email/SMS notifications and retries failed ones (run every 2–5 minutes). */
export async function POST(req: NextRequest) {
  const denied = authorizeCron(req, cronSecret());
  if (denied) return denied;
  const result = await runJob('send-notifications', () => dispatchNotifications(50));
  return NextResponse.json({ data: result });
}
