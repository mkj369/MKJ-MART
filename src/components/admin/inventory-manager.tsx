'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { History, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';
import { Table, Td, Th } from './ui';

type Row = {
  variantId: string;
  sku: string;
  stock: number;
  productId: string;
  productName: string;
  productStatus: 'draft' | 'active' | 'archived';
  sizeLabel: string | null;
  colorName: string | null;
  colorHex: string | null;
  image: string | null;
};

type Movement = { id: string; delta: number; stockAfter: number; reason: string; note: string | null; createdAt: string; actorName: string | null };

const REASONS = [
  { value: 'restock', label: 'Restock / new delivery' },
  { value: 'adjustment', label: 'Stock count adjustment' },
  { value: 'return', label: 'Customer return' },
  { value: 'correction', label: 'Correction (damaged, lost…)' },
];

export function InventoryTable({ rows, lowStockThreshold }: { rows: Row[]; lowStockThreshold: number }) {
  const router = useRouter();
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('restock');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<{ row: Row; items: Movement[] | null } | null>(null);

  const openAdjust = (row: Row) => {
    setAdjusting(row);
    setMode('delta');
    setValue('');
    setReason('restock');
    setNote('');
    setError(null);
  };

  const save = async () => {
    if (!adjusting) return;
    const n = Number(value);
    if (!Number.isInteger(n) || (mode === 'set' && n < 0) || (mode === 'delta' && n === 0)) {
      setError(mode === 'set' ? 'Enter the counted stock (0 or more).' : 'Enter a non-zero whole number, e.g. 12 or -2.');
      return;
    }
    setSaving(true);
    const result = await api<{ stock: number }>('/api/v1/admin/inventory/adjust', {
      body: { variantId: adjusting.variantId, mode, value: n, reason, note: note || null },
    });
    setSaving(false);
    if (!result.ok) return setError(result.error.fields?.value ?? result.error.message);
    toast(`${adjusting.sku}: stock is now ${result.data.stock}`);
    setAdjusting(null);
    router.refresh();
  };

  const openHistory = async (row: Row) => {
    setHistory({ row, items: null });
    const result = await api<Movement[]>(`/api/v1/admin/inventory/${row.variantId}/movements`);
    if (result.ok) setHistory({ row, items: result.data });
    else toast.error(result.error.message);
  };

  const preview = adjusting ? (mode === 'set' ? Number(value) || 0 : adjusting.stock + (Number(value) || 0)) : 0;

  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th className="w-14" />
            <Th>Product</Th>
            <Th>Variant</Th>
            <Th>SKU</Th>
            <Th>In stock</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.variantId} className="hover:bg-bone/50">
              <Td>
                <div className="relative h-12 w-9 bg-linen">{r.image ? <Image src={r.image} alt="" fill sizes="36px" className="object-cover" /> : null}</div>
              </Td>
              <Td>
                <Link href={`/admin/products/${r.productId}`} className="hover:underline">
                  {r.productName}
                </Link>
                {r.productStatus !== 'active' ? <Badge className="ml-2">{r.productStatus}</Badge> : null}
              </Td>
              <Td>
                <span className="inline-flex items-center gap-2">
                  {r.colorHex ? <span className="h-3 w-3 rounded-full border border-ink/15" style={{ backgroundColor: r.colorHex }} /> : null}
                  {[r.colorName, r.sizeLabel].filter(Boolean).join(' / ') || '—'}
                </span>
              </Td>
              <Td className="font-mono text-[12px] text-muted">{r.sku}</Td>
              <Td>
                <span className={cn('tabular-nums font-medium', r.stock === 0 ? 'text-danger' : r.stock <= lowStockThreshold ? 'text-warning' : '')}>{r.stock}</span>
                {r.stock === 0 ? <Badge tone="danger" className="ml-2">Out</Badge> : r.stock <= lowStockThreshold ? <Badge tone="warning" className="ml-2">Low</Badge> : null}
              </Td>
              <Td className="whitespace-nowrap text-right">
                <Button caps={false} size="sm" variant="outline" onClick={() => openAdjust(r)} data-testid={`adjust-${r.sku}`}>
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust
                </Button>
                <button type="button" className="ml-2 p-2 text-muted hover:text-ink" onClick={() => openHistory(r)} aria-label={`Stock history for ${r.sku}`}>
                  <History className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Dialog
        open={!!adjusting}
        onOpenChange={(o) => (o ? undefined : setAdjusting(null))}
        title="Adjust stock"
        description={adjusting ? `${adjusting.productName} · ${[adjusting.colorName, adjusting.sizeLabel].filter(Boolean).join(' / ')} · currently ${adjusting.stock}` : ''}
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setAdjusting(null)}>
              Cancel
            </Button>
            <Button caps={false} onClick={save} loading={saving}>
              Save adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-2 text-[13px]">
            {(['delta', 'set'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={cn('flex-1 border px-3 py-2', mode === m ? 'border-ink bg-ink text-paper' : 'border-line-strong')}>
                {m === 'delta' ? 'Add / remove units' : 'Set counted total'}
              </button>
            ))}
          </div>
          <Field label={mode === 'delta' ? 'Change (e.g. 12 or -2)' : 'Counted stock'} error={error ?? undefined}>
            {(p) => <Input {...p} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, ''))} autoFocus />}
          </Field>
          <Field label="Reason">
            {(p) => (
              <Select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Note">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — supplier invoice, count reference…" />}</Field>
          <p className="text-[13px] text-muted">
            New stock level: <span className={cn('font-medium tabular-nums', preview < 0 ? 'text-danger' : 'text-ink')}>{preview}</span>
          </p>
        </div>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(o) => (o ? undefined : setHistory(null))} title="Stock history" description={history ? `${history.row.sku} — every change is recorded` : ''}>
        {!history?.items ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : history.items.length === 0 ? (
          <p className="text-[13.5px] text-muted">No movements yet.</p>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {history.items.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-4 py-2.5">
                <div>
                  <p className="capitalize">{m.reason.replace('_', ' ')}</p>
                  <p className="text-[12px] text-muted">
                    {formatDateTime(m.createdAt)}
                    {m.actorName ? ` · ${m.actorName}` : ''}
                    {m.note ? ` · ${m.note}` : ''}
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <p className={m.delta > 0 ? 'text-success' : 'text-danger'}>{m.delta > 0 ? `+${m.delta}` : m.delta}</p>
                  <p className="text-[12px] text-muted">→ {m.stockAfter}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
