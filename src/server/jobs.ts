import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { jobRuns } from '@/server/db/schema';
import { log } from '@/server/logger';

export const JOB_NAMES = ['expire-payments', 'send-notifications', 'dispatch-events'] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** How often each job is expected to run; used by the admin launch checklist to flag a dead scheduler. */
export const JOB_EXPECTED_INTERVAL_MINUTES: Record<JobName, number> = {
  'expire-payments': 10,
  'send-notifications': 10,
  'dispatch-events': 30,
};

/** Runs a scheduled job and records a heartbeat (start, success/failure, result) in `job_runs`. */
export async function runJob<T>(name: JobName, fn: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  await db
    .insert(jobRuns)
    .values({ name, lastStartedAt: startedAt, runCount: 1 })
    .onConflictDoUpdate({ target: jobRuns.name, set: { lastStartedAt: startedAt, runCount: sql`${jobRuns.runCount} + 1` } });
  try {
    const result = await fn();
    await db
      .update(jobRuns)
      .set({ lastSucceededAt: new Date(), lastError: null, lastResult: (result ?? null) as never })
      .where(sql`${jobRuns.name} = ${name}`);
    log.info('job.succeeded', { job: name, ms: Date.now() - startedAt.getTime(), result });
    return result;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    await db.update(jobRuns).set({ lastFailedAt: new Date(), lastError: message }).where(sql`${jobRuns.name} = ${name}`);
    log.error('job.failed', { job: name, error: message });
    throw error;
  }
}

export async function listJobRuns() {
  return db.select().from(jobRuns);
}
