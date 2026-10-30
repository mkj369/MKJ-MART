import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/feedback';
import type { LaunchCheck } from '@/server/services/admin/launch';
import { cn, formatDateTime } from '@/lib/utils';
import { Panel } from './ui';

const ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle, info: Info } as const;
const TONE = { ok: 'text-success', warn: 'text-gold-deep', fail: 'text-danger', info: 'text-muted' } as const;

export function LaunchChecklist({ checks, blocking, warnings }: { checks: LaunchCheck[]; blocking: number; warnings: number }) {
  return (
    <Panel
      title="Launch readiness"
      actions={
        blocking ? <Badge tone="danger">{blocking} blocking</Badge> : warnings ? <Badge tone="warning">{warnings} to review</Badge> : <Badge tone="success">Ready</Badge>
      }
    >
      <p className="mb-4 text-[12.5px] text-muted">Checked live against this server’s configuration and data. Resolve every red item before taking real orders.</p>
      <ul className="divide-y divide-line border border-line" data-testid="launch-checklist">
        {checks.map((c) => {
          const Icon = ICON[c.status];
          return (
            <li key={c.id} className="flex gap-3 px-4 py-3 text-[13.5px]" data-status={c.status}>
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE[c.status])} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.label}
                  <span className="sr-only"> — {c.status === 'ok' ? 'OK' : c.status === 'fail' ? 'blocking' : c.status === 'warn' ? 'needs review' : 'information'}</span>
                </p>
                <p className="text-[12.5px] text-muted">{c.detail}</p>
              </div>
              {c.href ? (
                <Link href={c.href} className="shrink-0 self-center text-[12px] underline underline-offset-4">
                  Fix
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function JobsPanel({
  runs,
  expected,
}: {
  runs: { name: string; lastStartedAt: Date | null; lastSucceededAt: Date | null; lastFailedAt: Date | null; lastError: string | null; runCount: number }[];
  expected: Record<string, number>;
}) {
  return (
    <Panel title="Scheduled jobs">
      <p className="mb-4 text-[12.5px] text-muted">
        Called by your scheduler with <code className="bg-bone px-1">Authorization: Bearer $CRON_SECRET</code>. Expected frequency in brackets.
      </p>
      <ul className="divide-y divide-line border border-line text-[13px]">
        {Object.keys(expected).map((name) => {
          const run = runs.find((r) => r.name === name);
          const failedLast = run?.lastFailedAt && (!run.lastSucceededAt || run.lastFailedAt > run.lastSucceededAt);
          return (
            <li key={name} className="grid gap-1 px-4 py-3 sm:grid-cols-[200px_1fr]">
              <p className="font-medium">
                /api/cron/{name} <span className="font-normal text-muted">(every {expected[name]} min)</span>
              </p>
              <p className={cn('text-muted', failedLast && 'text-danger')}>
                {run?.lastSucceededAt ? `Last success ${formatDateTime(run.lastSucceededAt)} · ${run.runCount} runs` : 'Never run on this database.'}
                {failedLast ? ` · Last run failed: ${run!.lastError ?? 'unknown error'}` : ''}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function NotificationLog({
  rows,
}: {
  rows: { id: string; channel: string; template: string; recipient: string; subject: string | null; status: string; lastError: string | null; orderId: string | null; createdAt: Date }[];
}) {
  return (
    <Panel title="Notifications needing attention" bodyClassName="p-0">
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">No failed or unsent notifications.</p>
      ) : (
        <ul className="divide-y divide-line text-[12.5px]">
          {rows.map((n) => (
            <li key={n.id} className="grid gap-0.5 px-5 py-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <p className="truncate">
                  <span className="mr-2 uppercase tracking-[0.08em] text-muted">{n.channel}</span>
                  {n.subject ?? n.template.replace(/_/g, ' ')} → {n.recipient}
                </p>
                <p className="text-muted">
                  {formatDateTime(n.createdAt)}
                  {n.orderId ? (
                    <>
                      {' · '}
                      <Link href={`/admin/orders/${n.orderId}`} className="underline underline-offset-4">
                        order
                      </Link>
                    </>
                  ) : null}
                </p>
                {n.lastError ? <p className="text-danger">{n.lastError}</p> : null}
              </div>
              <Badge tone={n.status === 'failed' ? 'danger' : 'neutral'}>{n.status === 'skipped' ? 'not sent' : n.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
