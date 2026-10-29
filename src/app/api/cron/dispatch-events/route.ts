import { NextResponse, type NextRequest } from 'next/server';
import { cronSecret } from '@/server/env';
import { runJob } from '@/server/jobs';
import { dispatchPendingEvents } from '@/server/services/events';
import { authorizeCron } from '../authorize';

export const dynamic = 'force-dynamic';

/** Delivers pending domain events to the MKJ Ecosystem webhook. */
export async function POST(req: NextRequest) {
  const denied = authorizeCron(req, cronSecret());
  if (denied) return denied;
  return NextResponse.json({ data: await runJob('dispatch-events', () => dispatchPendingEvents()) });
}
