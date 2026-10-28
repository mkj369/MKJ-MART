'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { BD_DIVISIONS, DIVISION_NAMES } from '@/lib/bd-geo';
import { formatBDT } from '@/lib/money';
import { ROLE_LABEL, type Role } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import { Panel, Table, Td, Th } from './ui';

// ─── Customer account actions ─────────────────────────────────────────────────

export function CustomerActions({ id, status, role, canManage, isSelf }: { id: string; status: 'active' | 'blocked'; role: Role; canManage: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!canManage) return <p className="text-[13px] text-muted">Only administrators can block accounts or change roles.</p>;
  if (isSelf) return <p className="text-[13px] text-muted">This is your own account.</p>;

  const update = async (body: { status?: 'active' | 'blocked'; role?: Role }) => {
    setBusy(true);
    const result = await api(`/api/v1/admin/customers/${id}`, { method: 'PATCH', body });
    setBusy(false);
    setConfirm(false);
    if (!result.ok) return toast.error(result.error.message);
    toast('Account updated');
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Field label="Role">
        {(p) => (
          <Select {...p} value={role} disabled={busy} onChange={(e) => update({ role: e.target.value as Role })}>
            {(['customer', 'staff', 'admin'] as const).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {status === 'active' ? (
        <Button caps={false} variant="danger-outline" size="sm" onClick={() => setConfirm(true)}>
          Block account
        </Button>
      ) : (
        <Button caps={false} variant="outline" size="sm" onClick={() => update({ status: 'active' })} loading={busy}>
          Unblock account
        </Button>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Block this account?"
        description="They are signed out everywhere immediately and cannot sign in until unblocked. Existing orders are not affected."
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button caps={false} variant="danger" onClick={() => update({ status: 'blocked' })} loading={busy}>
              Block account
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-muted">Use this for fraud, abuse or repeated fake orders.</p>
      </Dialog>
    </div>
  );
}

// ─── Coupons ──────────────────────────────────────────────────────────────────

type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  type: 'percentage' | 'fixed';
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
  usedCount: number;
  isActive: boolean;
  isDemo: boolean;
  state: 'live' | 'inactive' | 'expired' | 'scheduled' | 'used_up';
};

type CouponForm = Omit<CouponRow, 'id' | 'usedCount' | 'isDemo' | 'description' | 'state'> & { description: string };

const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export function CouponManager({ coupons }: { coupons: CouponRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; form: CouponForm } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const open = (c?: CouponRow) => {
    setErrors({});
    setEditing({
      id: c?.id ?? null,
      form: c
        ? (({ id: _id, usedCount: _u, isDemo: _d, state: _s, ...rest }) => ({ ...rest, description: c.description ?? '' }))(c)
        : { code: '', description: '', type: 'percentage', value: 10, minOrderAmount: 0, maxDiscountAmount: null, startsAt: null, endsAt: null, usageLimit: null, usageLimitPerCustomer: 1, isActive: true },
    });
  };
  const set = (patch: Partial<CouponForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const f = editing.form;
    const body = { ...f, description: f.description || null };
    const result = editing.id ? await api(`/api/v1/admin/coupons/${editing.id}`, { method: 'PUT', body }) : await api('/api/v1/admin/coupons', { body });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      return toast.error(result.error.message);
    }
    toast('Coupon saved');
    setEditing(null);
    router.refresh();
  };

  const remove = async (id: string) => {
    const result = await api(`/api/v1/admin/coupons/${id}`, { method: 'DELETE' });
    if (!result.ok) return toast.error(result.error.message);
    toast('Coupon deleted');
    router.refresh();
  };

  const state = (c: CouponRow) =>
    ({
      inactive: <Badge>Inactive</Badge>,
      expired: <Badge tone="danger">Expired</Badge>,
      scheduled: <Badge tone="info">Scheduled</Badge>,
      used_up: <Badge tone="warning">Used up</Badge>,
      live: <Badge tone="success">Live</Badge>,
    })[c.state];

  const f = editing?.form;
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button caps={false} size="sm" onClick={() => open()}>
          <Plus className="h-4 w-4" /> New coupon
        </Button>
      </div>
      {coupons.length === 0 ? (
        <EmptyState className="border border-line bg-paper" title="No coupons yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Discount</Th>
              <Th>Conditions</Th>
              <Th>Used</Th>
              <Th>Valid until</Th>
              <Th>State</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} className="hover:bg-bone/50">
                <Td>
                  <span className="font-mono font-medium">{c.code}</span>
                  {c.isDemo ? <Badge tone="gold" className="ml-2">Demo</Badge> : null}
                  {c.description ? <p className="text-[12px] text-muted">{c.description}</p> : null}
                </Td>
                <Td>{c.type === 'percentage' ? `${c.value}%${c.maxDiscountAmount ? ` (max ${formatBDT(c.maxDiscountAmount)})` : ''}` : formatBDT(c.value)}</Td>
                <Td className="text-[12.5px] text-muted">
                  {c.minOrderAmount ? `Min ${formatBDT(c.minOrderAmount)}` : 'No minimum'}
                  {c.usageLimitPerCustomer ? ` · ${c.usageLimitPerCustomer}/customer` : ''}
                </Td>
                <Td className="tabular-nums">
                  {c.usedCount}
                  {c.usageLimit ? ` / ${c.usageLimit}` : ''}
                </Td>
                <Td className="text-muted">{c.endsAt ? formatDate(c.endsAt) : 'No end date'}</Td>
                <Td>{state(c)}</Td>
                <Td className="whitespace-nowrap text-right text-[13px]">
                  <button type="button" className="underline underline-offset-4" onClick={() => open(c)}>
                    Edit
                  </button>
                  {c.usedCount === 0 ? (
                    <button type="button" className="ml-4 text-danger underline underline-offset-4" onClick={() => remove(c.id)}>
                      Delete
                    </button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(o) => (o ? undefined : setEditing(null))}
        title={editing?.id ? 'Edit coupon' : 'New coupon'}
        className="max-w-2xl"
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button caps={false} onClick={save} loading={saving}>
              Save coupon
            </Button>
          </>
        }
      >
        {f ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" required error={errors.code}>
              {(p) => <Input {...p} className="uppercase" value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />}
            </Field>
            <Field label="Description" error={errors.description}>
              {(p) => <Input {...p} value={f.description} onChange={(e) => set({ description: e.target.value })} />}
            </Field>
            <Field label="Type" error={errors.type}>
              {(p) => (
                <Select {...p} value={f.type} onChange={(e) => set({ type: e.target.value as 'percentage' | 'fixed', value: e.target.value === 'percentage' ? 10 : 50000 })}>
                  <option value="percentage">Percentage off</option>
                  <option value="fixed">Fixed amount off</option>
                </Select>
              )}
            </Field>
            {f.type === 'percentage' ? (
              <Field label="Percent" required error={errors.value}>
                {(p) => <Input {...p} inputMode="numeric" value={String(f.value)} onChange={(e) => set({ value: Number(e.target.value.replace(/\D/g, '')) || 0 })} />}
              </Field>
            ) : (
              <Field label="Amount" required error={errors.value}>
                {(p) => <MoneyInput {...p} value={f.value} onChange={(v) => set({ value: v ?? 0 })} />}
              </Field>
            )}
            <Field label="Minimum order" error={errors.minOrderAmount}>
              {(p) => <MoneyInput {...p} value={f.minOrderAmount} onChange={(v) => set({ minOrderAmount: v ?? 0 })} />}
            </Field>
            <Field label="Maximum discount" error={errors.maxDiscountAmount} hint="Caps percentage discounts.">
              {(p) => <MoneyInput {...p} value={f.maxDiscountAmount} onChange={(v) => set({ maxDiscountAmount: v })} />}
            </Field>
            <Field label="Starts" error={errors.startsAt}>
              {(p) => <Input {...p} type="datetime-local" value={toLocalInput(f.startsAt)} onChange={(e) => set({ startsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />}
            </Field>
            <Field label="Ends" error={errors.endsAt}>
              {(p) => <Input {...p} type="datetime-local" value={toLocalInput(f.endsAt)} onChange={(e) => set({ endsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />}
            </Field>
            <Field label="Total uses allowed" error={errors.usageLimit} hint="Blank = unlimited">
              {(p) => <Input {...p} inputMode="numeric" value={f.usageLimit ?? ''} onChange={(e) => set({ usageLimit: e.target.value ? Number(e.target.value.replace(/\D/g, '')) || null : null })} />}
            </Field>
            <Field label="Uses per customer" error={errors.usageLimitPerCustomer} hint="Matched by account and phone">
              {(p) => <Input {...p} inputMode="numeric" value={f.usageLimitPerCustomer ?? ''} onChange={(e) => set({ usageLimitPerCustomer: e.target.value ? Number(e.target.value.replace(/\D/g, '')) || null : null })} />}
            </Field>
            <Checkbox className="sm:col-span-2" label="Active" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

// ─── Delivery zones ───────────────────────────────────────────────────────────

type ZoneRow = { id: string; name: string; fee: number; estimatedDays: string; districts: string[]; isDefault: boolean; isActive: boolean; sortOrder: number };
type ZoneForm = Omit<ZoneRow, 'id'>;

export function ShippingManager({ zones }: { zones: ZoneRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; form: ZoneForm } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const takenElsewhere = (district: string) => zones.some((z) => z.id !== editing?.id && z.districts.includes(district));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const result = editing.id
      ? await api(`/api/v1/admin/shipping-zones/${editing.id}`, { method: 'PUT', body: editing.form })
      : await api('/api/v1/admin/shipping-zones', { body: editing.form });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      return toast.error(result.error.message);
    }
    toast('Delivery zone saved');
    setEditing(null);
    router.refresh();
  };
  const remove = async (id: string) => {
    const result = await api(`/api/v1/admin/shipping-zones/${id}`, { method: 'DELETE' });
    if (!result.ok) return toast.error(result.error.message);
    router.refresh();
  };
  const set = (patch: Partial<ZoneForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const f = editing?.form;

  return (
    <>
      {!zones.some((z) => z.isDefault && z.isActive) ? (
        <Alert tone="warning" className="mb-4" title="No active default zone">
          Districts not listed in any zone cannot be delivered to. Mark one zone as the default (catch-all).
        </Alert>
      ) : null}
      <div className="mb-4 flex justify-end">
        <Button caps={false} size="sm" onClick={() => (setErrors({}), setEditing({ id: null, form: { name: '', fee: 10000, estimatedDays: '2–3 days', districts: [], isDefault: false, isActive: true, sortOrder: zones.length } }))}>
          <Plus className="h-4 w-4" /> New zone
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {zones.map((z) => (
          <Panel
            key={z.id}
            title={z.name}
            actions={
              <div className="flex gap-1">
                {z.isDefault ? <Badge tone="gold">Default</Badge> : null}
                {!z.isActive ? <Badge>Inactive</Badge> : null}
              </div>
            }
          >
            <p className="font-display text-[30px] leading-none">{formatBDT(z.fee)}</p>
            <p className="mt-1 text-[13px] text-muted">{z.estimatedDays}</p>
            <p className="mt-4 text-[13px]">{z.isDefault && z.districts.length === 0 ? 'All other districts' : z.districts.join(', ') || 'No districts'}</p>
            <div className="mt-4 flex gap-4 text-[13px]">
              <button type="button" className="underline underline-offset-4" onClick={() => (setErrors({}), setEditing({ id: z.id, form: { ...z } }))}>
                Edit
              </button>
              {!z.isDefault ? (
                <button type="button" className="text-danger underline underline-offset-4" onClick={() => remove(z.id)}>
                  Delete
                </button>
              ) : null}
            </div>
          </Panel>
        ))}
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(o) => (o ? undefined : setEditing(null))}
        title={editing?.id ? 'Edit delivery zone' : 'New delivery zone'}
        className="max-w-3xl"
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button caps={false} onClick={save} loading={saving}>
              Save zone
            </Button>
          </>
        }
      >
        {f ? (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" required error={errors.name}>
                {(p) => <Input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} />}
              </Field>
              <Field label="Delivery fee" required error={errors.fee}>
                {(p) => <MoneyInput {...p} value={f.fee} onChange={(v) => set({ fee: v ?? 0 })} />}
              </Field>
              <Field label="Estimate" required error={errors.estimatedDays}>
                {(p) => <Input {...p} value={f.estimatedDays} onChange={(e) => set({ estimatedDays: e.target.value })} />}
              </Field>
            </div>
            <div className="flex flex-wrap gap-6">
              <Checkbox label="Default zone (all unlisted districts)" checked={f.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} />
              <Checkbox label="Active" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em]">Districts ({f.districts.length})</p>
              {errors.districts ? <p className="mb-2 text-[12.5px] text-danger">{errors.districts}</p> : null}
              <div className="grid max-h-[340px] gap-4 overflow-y-auto border border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
                {DIVISION_NAMES.map((division) => (
                  <div key={division}>
                    <p className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-muted">{division}</p>
                    {BD_DIVISIONS[division].map((d) => (
                      <label key={d} className={`flex items-center gap-2 py-0.5 text-[13px] ${takenElsewhere(d) ? 'text-faint' : ''}`}>
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={f.districts.includes(d)}
                          disabled={takenElsewhere(d)}
                          onChange={(e) => set({ districts: e.target.checked ? [...f.districts, d] : f.districts.filter((x) => x !== d) })}
                        />
                        {d}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-muted">Greyed-out districts already belong to another zone.</p>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

type SettingsData = {
  store: { storeName: string; tagline: string; supportEmail: string; supportPhone: string; address: string; facebookUrl: string; instagramUrl: string };
  checkout: { codEnabled: boolean; codMaxOrderAmount: number | null; onlinePaymentEnabled: boolean; guestCheckoutEnabled: boolean; freeShippingThreshold: number | null; maxQuantityPerItem: number; lowStockThreshold: number };
  policies: { shipping: string; returns: string; privacy: string; terms: string };
  announcement: { enabled: boolean; message: string };
};

function useSettingsSave<K extends keyof SettingsData>(key: K) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (value: SettingsData[K]) => {
    setSaving(true);
    const result = await api(`/api/v1/admin/settings/${key}`, { method: 'PUT', body: value });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      return toast.error(result.error.message);
    }
    setErrors({});
    toast('Settings saved');
    router.refresh();
  };
  return { saving, errors, save };
}

export function StoreSettingsForm({ initial }: { initial: SettingsData['store'] }) {
  const [v, setV] = useState(initial);
  const { saving, errors, save } = useSettingsSave('store');
  return (
    <Panel title="Store details">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Store name" error={errors.storeName}>{(p) => <Input {...p} value={v.storeName} onChange={(e) => setV({ ...v, storeName: e.target.value })} />}</Field>
        <Field label="Tagline" error={errors.tagline}>{(p) => <Input {...p} value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} />}</Field>
        <Field label="Support email" error={errors.supportEmail}>{(p) => <Input {...p} type="email" value={v.supportEmail} onChange={(e) => setV({ ...v, supportEmail: e.target.value })} />}</Field>
        <Field label="Support phone" error={errors.supportPhone}>{(p) => <Input {...p} type="tel" value={v.supportPhone} onChange={(e) => setV({ ...v, supportPhone: e.target.value })} />}</Field>
        <Field label="Address" error={errors.address} className="md:col-span-2">{(p) => <Input {...p} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />}</Field>
        <Field label="Facebook URL" error={errors.facebookUrl}>{(p) => <Input {...p} value={v.facebookUrl} onChange={(e) => setV({ ...v, facebookUrl: e.target.value })} />}</Field>
        <Field label="Instagram URL" error={errors.instagramUrl}>{(p) => <Input {...p} value={v.instagramUrl} onChange={(e) => setV({ ...v, instagramUrl: e.target.value })} />}</Field>
      </div>
      <Button caps={false} className="mt-5" onClick={() => save(v)} loading={saving}>
        Save
      </Button>
    </Panel>
  );
}

export function CheckoutSettingsForm({ initial, gateway }: { initial: SettingsData['checkout']; gateway: { configured: boolean; mode: string | null } }) {
  const [v, setV] = useState(initial);
  const { saving, errors, save } = useSettingsSave('checkout');
  return (
    <Panel title="Checkout & payments">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 border border-line p-4">
            <Checkbox label="Cash on Delivery" description="Collect payment at the door." checked={v.codEnabled} onChange={(e) => setV({ ...v, codEnabled: e.target.checked })} />
            <Field label="COD order limit" error={errors.codMaxOrderAmount} hint="Orders above this must be paid online. Blank = no limit.">
              {(p) => <MoneyInput {...p} value={v.codMaxOrderAmount} onChange={(x) => setV({ ...v, codMaxOrderAmount: x })} />}
            </Field>
          </div>
          <div className="space-y-3 border border-line p-4">
            <Checkbox label="Online payment (SSLCommerz)" description="bKash, Nagad, Rocket, cards, internet banking." checked={v.onlinePaymentEnabled} onChange={(e) => setV({ ...v, onlinePaymentEnabled: e.target.checked })} />
            {gateway.configured ? (
              <Alert tone="success">Credentials configured · {gateway.mode} mode</Alert>
            ) : (
              <Alert tone="warning">Not configured — set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD on the server. Online payment stays hidden until then.</Alert>
            )}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Free delivery from" error={errors.freeShippingThreshold} hint="Blank = never free">
            {(p) => <MoneyInput {...p} value={v.freeShippingThreshold} onChange={(x) => setV({ ...v, freeShippingThreshold: x })} />}
          </Field>
          <Field label="Max quantity per item" error={errors.maxQuantityPerItem}>
            {(p) => <Input {...p} inputMode="numeric" value={String(v.maxQuantityPerItem)} onChange={(e) => setV({ ...v, maxQuantityPerItem: Number(e.target.value.replace(/\D/g, '')) || 1 })} />}
          </Field>
          <Field label="Low-stock threshold" error={errors.lowStockThreshold}>
            {(p) => <Input {...p} inputMode="numeric" value={String(v.lowStockThreshold)} onChange={(e) => setV({ ...v, lowStockThreshold: Number(e.target.value.replace(/\D/g, '')) || 0 })} />}
          </Field>
        </div>
        <Checkbox label="Allow guest checkout" description="Customers can order without creating an account." checked={v.guestCheckoutEnabled} onChange={(e) => setV({ ...v, guestCheckoutEnabled: e.target.checked })} />
      </div>
      <Button caps={false} className="mt-5" onClick={() => save(v)} loading={saving}>
        Save
      </Button>
    </Panel>
  );
}

export function AnnouncementForm({ initial }: { initial: SettingsData['announcement'] }) {
  const [v, setV] = useState(initial);
  const { saving, errors, save } = useSettingsSave('announcement');
  return (
    <Panel title="Announcement bar">
      <div className="space-y-4">
        <Checkbox label="Show announcement bar" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />
        <Field label="Message" error={errors.message}>{(p) => <Input {...p} maxLength={160} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} />}</Field>
      </div>
      <Button caps={false} className="mt-5" onClick={() => save(v)} loading={saving}>
        Save
      </Button>
    </Panel>
  );
}

export function PoliciesForm({ initial }: { initial: SettingsData['policies'] }) {
  const [v, setV] = useState(initial);
  const { saving, errors, save } = useSettingsSave('policies');
  const labels: Record<keyof SettingsData['policies'], string> = { shipping: 'Delivery & charges', returns: 'Returns & exchanges', privacy: 'Privacy policy', terms: 'Terms of service' };
  return (
    <Panel title="Policies">
      <p className="mb-4 text-[12.5px] text-muted">Plain text. Start a line with “## ” for a heading and “- ” for a bullet. Templates — have them reviewed before launch.</p>
      <div className="grid gap-5 lg:grid-cols-2">
        {(Object.keys(labels) as (keyof SettingsData['policies'])[]).map((k) => (
          <Field key={k} label={labels[k]} error={errors[k]}>
            {(p) => <Textarea {...p} rows={10} className="font-mono text-[12.5px]" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
          </Field>
        ))}
      </div>
      <Button caps={false} className="mt-5" onClick={() => save(v)} loading={saving}>
        Save policies
      </Button>
    </Panel>
  );
}

export function DemoDataPanel({ summary }: { summary: { users: number; products: number; categories: number; collections: number; coupons: number; orders: number; total: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const purge = async () => {
    setBusy(true);
    const result = await api<Record<string, number>>('/api/v1/admin/demo-data', { method: 'DELETE' });
    setBusy(false);
    setOpen(false);
    if (!result.ok) return toast.error(result.error.message);
    toast(`Demo data removed: ${result.data.products} products, ${result.data.orders} orders, ${result.data.users} accounts.`);
    router.refresh();
  };
  return (
    <Panel title="Demo data">
      {summary.total === 0 ? (
        <p className="text-[13.5px] text-muted">No demo data — this store contains only your real records.</p>
      ) : (
        <>
          <p className="text-[13.5px]">
            This database contains sample records created by <code className="bg-bone px-1">npm run db:seed -- --demo</code>, flagged as demo:
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-[13px] text-muted sm:grid-cols-3">
            <li>{summary.products} products</li>
            <li>{summary.orders} orders</li>
            <li>{summary.users} accounts</li>
            <li>{summary.categories} categories</li>
            <li>{summary.collections} collections</li>
            <li>{summary.coupons} coupons</li>
          </ul>
          <Alert tone="warning" className="mt-4">
            Remove all demo data before launch. Your own products, orders and accounts are not touched; your current admin account is kept.
          </Alert>
          <Button caps={false} variant="danger-outline" className="mt-4" onClick={() => setOpen(true)}>
            Remove demo data…
          </Button>
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Remove all demo data?"
        description="This cannot be undone."
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button caps={false} variant="danger" disabled={typed !== 'REMOVE DEMO DATA'} onClick={purge} loading={busy}>
              Remove permanently
            </Button>
          </>
        }
      >
        <Field label='Type "REMOVE DEMO DATA" to confirm'>{(p) => <Input {...p} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
      </Dialog>
    </Panel>
  );
}
