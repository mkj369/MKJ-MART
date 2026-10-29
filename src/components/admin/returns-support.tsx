'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import type { ReturnStatus } from '@/lib/returns';
import { Panel } from './ui';

type Action = 'approve' | 'reject' | 'receive';

const ACTION_COPY: Record<Action, { title: string; description: string; noteLabel: string; button: string }> = {
  approve: {
    title: 'Approve return',
    description: 'The customer is emailed the return instructions from Settings → Returns (plus your note).',
    noteLabel: 'Note to the customer (optional)',
    button: 'Approve',
  },
  reject: {
    title: 'Decline return',
    description: 'The customer sees and is emailed your reason.',
    noteLabel: 'Reason (shown to the customer)',
    button: 'Decline',
  },
  receive: {
    title: 'Mark items received',
    description: 'Confirm the parcel arrived. Restock puts the units back into sellable inventory with a ledger entry.',
    noteLabel: 'Note to the customer (optional)',
    button: 'Mark received',
  },
};

export function ReturnActions({ id, status }: { id: string; status: ReturnStatus }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [customerNote, setCustomerNote] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [restock, setRestock] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const available: Action[] = status === 'requested' ? ['approve', 'reject'] : status === 'approved' ? ['receive', 'reject'] : [];

  const submit = async () => {
    if (!action) return;
    setBusy(true);
    const result = await api(`/api/v1/admin/returns/${id}`, {
      method: 'PATCH',
      body: { action, customerNote: customerNote || null, adminNote: adminNote || null, restock },
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      return toast.error(result.error.message);
    }
    toast('Return updated');
    setAction(null);
    setCustomerNote('');
    router.refresh();
  };

  if (available.length === 0) return null;
  return (
    <Panel title="Next step">
      <div className="flex flex-wrap gap-2">
        {available.map((a) => (
          <Button
            key={a}
            caps={false}
            size="sm"
            variant={a === 'reject' ? 'danger-outline' : 'primary'}
            onClick={() => (setErrors({}), setAction(a))}
            data-testid={`return-action-${a}`}
          >
            {ACTION_COPY[a].button}
          </Button>
        ))}
      </div>
      <Dialog
        open={action !== null}
        onOpenChange={(o) => (o ? undefined : setAction(null))}
        title={action ? ACTION_COPY[action].title : ''}
        description={action ? ACTION_COPY[action].description : ''}
        footer={
          <>
            <Button variant="outline" caps={false} onClick={() => setAction(null)}>
              Back
            </Button>
            <Button caps={false} variant={action === 'reject' ? 'danger' : 'primary'} onClick={submit} loading={busy}>
              {action ? ACTION_COPY[action].button : ''}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {action === 'receive' ? (
            <Checkbox label="Restock the returned units" description="Untick for damaged or unsellable items." checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          ) : null}
          <Field label={action ? ACTION_COPY[action].noteLabel : ''} error={errors.customerNote} required={action === 'reject'}>
            {(p) => <Textarea {...p} rows={3} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />}
          </Field>
          <Field label="Internal note" error={errors.adminNote}>
            {(p) => <Textarea {...p} rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </Panel>
  );
}

export function SupportActions({ id, status, adminNote }: { id: string; status: 'open' | 'in_progress' | 'resolved'; adminNote: string }) {
  const router = useRouter();
  const [v, setV] = useState({ status, adminNote });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const result = await api(`/api/v1/admin/support/${id}`, { method: 'PATCH', body: { status: v.status, adminNote: v.adminNote || null } });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    toast('Saved');
    router.refresh();
  };
  return (
    <Panel title="Handling">
      <div className="space-y-4">
        <Field label="Status">
          {(p) => (
            <Select {...p} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as typeof status })}>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
            </Select>
          )}
        </Field>
        <Field label="Internal note" hint="Visible to staff only.">
          {(p) => <Textarea {...p} rows={4} value={v.adminNote} onChange={(e) => setV({ ...v, adminNote: e.target.value })} />}
        </Field>
        <Button caps={false} size="sm" onClick={save} loading={busy} disabled={v.status === status && v.adminNote === adminNote}>
          Save
        </Button>
      </div>
    </Panel>
  );
}
