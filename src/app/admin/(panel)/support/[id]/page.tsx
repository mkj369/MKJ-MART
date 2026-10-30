import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/feedback';
import { buttonClasses } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/admin/ui';
import { SupportActions } from '@/components/admin/returns-support';
import { requireAdminPage } from '@/server/auth/current-user';
import { getSupportAdmin } from '@/server/services/support';
import { formatBdPhone } from '@/lib/phone';
import { formatDateTime } from '@/lib/utils';
import { SUPPORT_TOPIC_LABEL, type SupportTopic } from '@/lib/validation/store';

export const metadata: Metadata = { title: 'Support request' };

export default async function AdminSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage('support:manage', `/admin/support/${id}`);
  const { ticket, order } = await getSupportAdmin(id);
  const subject = encodeURIComponent(`Re: your message ${ticket.ticketNumber}`);
  return (
    <>
      <PageHeader
        back={{ href: '/admin/support', label: 'Support inbox' }}
        title={ticket.ticketNumber}
        description={`${SUPPORT_TOPIC_LABEL[ticket.topic as SupportTopic] ?? ticket.topic} · received ${formatDateTime(ticket.createdAt)}`}
        actions={ticket.isDemo ? <Badge tone="gold">Demo</Badge> : undefined}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Panel title={`Message from ${ticket.name}`}>
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{ticket.message}</p>
          </Panel>
          <div className="flex flex-wrap gap-2">
            {ticket.email ? (
              <a className={buttonClasses({ size: 'sm', caps: false })} href={`mailto:${ticket.email}?subject=${subject}`}>
                Reply by email
              </a>
            ) : null}
            {ticket.phone ? (
              <>
                <a className={buttonClasses({ size: 'sm', variant: 'outline', caps: false })} href={`tel:${ticket.phone}`}>
                  Call {formatBdPhone(ticket.phone)}
                </a>
                <a
                  className={buttonClasses({ size: 'sm', variant: 'outline', caps: false })}
                  href={`https://wa.me/88${ticket.phone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
              </>
            ) : null}
          </div>
        </div>
        <div className="space-y-6">
          <Panel title="Contact">
            <div className="space-y-1 text-[13.5px]">
              <p className="font-medium">{ticket.name}</p>
              {ticket.email ? <p className="text-muted">{ticket.email}</p> : null}
              {ticket.phone ? <p className="text-muted">{formatBdPhone(ticket.phone)}</p> : null}
              {ticket.orderNumber ? (
                <p className="pt-2">
                  Order:{' '}
                  {order ? (
                    <Link href={`/admin/orders/${order.id}`} className="underline underline-offset-4">
                      {order.orderNumber}
                    </Link>
                  ) : (
                    <span className="text-muted">{ticket.orderNumber} (not found)</span>
                  )}
                </p>
              ) : null}
            </div>
          </Panel>
          <SupportActions id={ticket.id} status={ticket.status} adminNote={ticket.adminNote ?? ''} />
        </div>
      </div>
    </>
  );
}
