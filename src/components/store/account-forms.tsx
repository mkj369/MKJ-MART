'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { BD_DIVISIONS, DIVISION_NAMES, type Division } from '@/lib/bd-geo';
import { formatBdPhone } from '@/lib/phone';
import { zodFieldErrors } from '@/lib/validation/common';
import { addressSchema, changePasswordSchema, profileSchema } from '@/lib/validation/store';

export function ProfileForm({ initial }: { initial: { name: string; phone: string } }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = profileSchema.safeParse({ ...values, phone: values.phone || undefined });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    setSaving(true);
    const result = await api('/api/v1/account/profile', { method: 'PATCH', body: parsed.data });
    setSaving(false);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      return toast.error(result.error.message);
    }
    toast('Profile updated');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2" noValidate>
      <Field label="Full name" error={errors.name}>
        {(p) => <Input {...p} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />}
      </Field>
      <Field label="Mobile number" error={errors.phone}>
        {(p) => <Input {...p} type="tel" placeholder="01XXXXXXXXX" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />}
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [values, setValues] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = changePasswordSchema.safeParse(values);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    setSaving(true);
    const result = await api('/api/v1/account/password', { body: parsed.data });
    setSaving(false);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      else toast.error(result.error.message);
      return;
    }
    setValues({ currentPassword: '', newPassword: '' });
    toast('Password changed. Other devices have been signed out.');
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Current password" error={errors.currentPassword}>
        {(p) => <Input {...p} type="password" autoComplete="current-password" value={values.currentPassword} onChange={(e) => setValues({ ...values, currentPassword: e.target.value })} />}
      </Field>
      <Field label="New password" error={errors.newPassword} hint="At least 8 characters, with a letter and a number.">
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={values.newPassword} onChange={(e) => setValues({ ...values, newPassword: e.target.value })} />}
      </Field>
      <Button type="submit" loading={saving}>
        Update password
      </Button>
    </form>
  );
}

type AddressRow = {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  area: string;
  district: string;
  division: string;
  postalCode: string;
  isDefault: boolean;
};

export function AddressBook({ addresses, defaultName, defaultPhone }: { addresses: AddressRow[]; defaultName: string; defaultPhone: string }) {
  const router = useRouter();
  const blank: Omit<AddressRow, 'id'> = {
    label: 'Home',
    recipientName: defaultName,
    phone: defaultPhone,
    addressLine: '',
    area: '',
    district: '',
    division: '',
    postalCode: '',
    isDefault: addresses.length === 0,
  };
  const [editing, setEditing] = useState<{ id: string | null; values: Omit<AddressRow, 'id'> } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing) return;
    const parsed = addressSchema.safeParse({ ...editing.values, postalCode: editing.values.postalCode || undefined });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    setSaving(true);
    const result = editing.id
      ? await api(`/api/v1/account/addresses/${editing.id}`, { method: 'PATCH', body: parsed.data })
      : await api('/api/v1/account/addresses', { body: parsed.data });
    setSaving(false);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      return toast.error(result.error.message);
    }
    setEditing(null);
    toast(editing.id ? 'Address updated' : 'Address saved');
    router.refresh();
  };

  const remove = async (id: string) => {
    const result = await api(`/api/v1/account/addresses/${id}`, { method: 'DELETE' });
    if (!result.ok) return toast.error(result.error.message);
    toast('Address removed');
    router.refresh();
  };

  const makeDefault = async (a: AddressRow) => {
    const { id: _id, ...values } = a;
    const result = await api(`/api/v1/account/addresses/${a.id}`, { method: 'PATCH', body: { ...values, postalCode: values.postalCode || undefined, isDefault: true } });
    if (!result.ok) return toast.error(result.error.message);
    router.refresh();
  };

  const v = editing?.values;
  const set = (patch: Partial<Omit<AddressRow, 'id'>>) => setEditing((e) => (e ? { ...e, values: { ...e.values, ...patch } } : e));
  const districts = v?.division && v.division in BD_DIVISIONS ? BD_DIVISIONS[v.division as Division] : [];

  return (
    <div>
      <div className="flex items-center justify-between border-b border-line pb-3">
        <h2 className="eyebrow">Saved addresses</h2>
        <Button size="sm" variant="secondary" onClick={() => { setErrors({}); setEditing({ id: null, values: blank }); }}>
          <Plus className="h-3.5 w-3.5" /> Add address
        </Button>
      </div>
      {addresses.length === 0 ? (
        <EmptyState icon={<MapPin className="h-6 w-6" strokeWidth={1.25} />} title="No saved addresses" description="Save an address for faster checkout." />
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="border border-line p-5 text-[14px]">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{a.label}</span>
                {a.isDefault ? <Badge tone="gold">Default</Badge> : null}
              </div>
              <p className="mt-3 font-medium">{a.recipientName}</p>
              <p className="text-muted">{formatBdPhone(a.phone)}</p>
              <p className="mt-2 leading-relaxed">
                {a.addressLine}, {a.area}
                <br />
                {a.district}
                {a.postalCode ? ` ${a.postalCode}` : ''}, {a.division}
              </p>
              <div className="mt-4 flex flex-wrap gap-4 text-[13px]">
                <button type="button" className="underline underline-offset-4" onClick={() => { setErrors({}); setEditing({ id: a.id, values: { ...a } }); }}>
                  Edit
                </button>
                {!a.isDefault ? (
                  <button type="button" className="underline underline-offset-4" onClick={() => makeDefault(a)}>
                    Set as default
                  </button>
                ) : null}
                <button type="button" className="text-danger underline underline-offset-4" onClick={() => remove(a.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing?.id ? 'Edit address' : 'New address'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save address
            </Button>
          </>
        }
      >
        {v ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Label" error={errors.label}>
              {(p) => <Input {...p} placeholder="Home, Office…" value={v.label} onChange={(e) => set({ label: e.target.value })} />}
            </Field>
            <Field label="Recipient name" error={errors.recipientName}>
              {(p) => <Input {...p} value={v.recipientName} onChange={(e) => set({ recipientName: e.target.value })} />}
            </Field>
            <Field label="Mobile number" error={errors.phone}>
              {(p) => <Input {...p} type="tel" placeholder="01XXXXXXXXX" value={v.phone} onChange={(e) => set({ phone: e.target.value })} />}
            </Field>
            <Field label="Division" error={errors.division}>
              {(p) => (
                <Select {...p} value={v.division} onChange={(e) => set({ division: e.target.value, district: '' })}>
                  <option value="">Select division</option>
                  {DIVISION_NAMES.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="District" error={errors.district}>
              {(p) => (
                <Select {...p} value={v.district} disabled={!v.division} onChange={(e) => set({ district: e.target.value })}>
                  <option value="">Select district</option>
                  {districts.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Area / Thana" error={errors.area}>
              {(p) => <Input {...p} value={v.area} onChange={(e) => set({ area: e.target.value })} />}
            </Field>
            <Field label="Street address" error={errors.addressLine} className="sm:col-span-2">
              {(p) => <Input {...p} placeholder="House, road, block, landmark" value={v.addressLine} onChange={(e) => set({ addressLine: e.target.value })} />}
            </Field>
            <Field label="Postal code" error={errors.postalCode}>
              {(p) => <Input {...p} inputMode="numeric" value={v.postalCode} onChange={(e) => set({ postalCode: e.target.value })} />}
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox label="Use as default address" checked={v.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
