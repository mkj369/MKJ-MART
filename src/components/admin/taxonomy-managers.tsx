'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { ImageField } from './image-field';
import { Panel, Table, Td, Th } from './ui';

function useSaver() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = async (path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, success?: string) => {
    setSaving(true);
    const result = await api(path, { method, body });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return false;
    }
    setErrors({});
    if (success) toast(success);
    router.refresh();
    return true;
  };
  return { saving, errors, setErrors, run };
}

// ─── Categories ───────────────────────────────────────────────────────────────

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  isActive: boolean;
  isDemo: boolean;
  productCount: number;
};

type CategoryForm = { name: string; slug: string; description: string; imageUrl: string | null; parentId: string; sortOrder: number; isActive: boolean };

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const { saving, errors, setErrors, run } = useSaver();
  const [editing, setEditing] = useState<{ id: string | null; form: CategoryForm } | null>(null);
  const roots = categories.filter((c) => !c.parentId);
  const ordered = roots.flatMap((r) => [r, ...categories.filter((c) => c.parentId === r.id)]);

  const open = (c?: CategoryRow) => {
    setErrors({});
    setEditing({
      id: c?.id ?? null,
      form: c
        ? { name: c.name, slug: c.slug, description: c.description ?? '', imageUrl: c.imageUrl, parentId: c.parentId ?? '', sortOrder: c.sortOrder, isActive: c.isActive }
        : { name: '', slug: '', description: '', imageUrl: null, parentId: '', sortOrder: 0, isActive: true },
    });
  };
  const save = async () => {
    if (!editing) return;
    const f = editing.form;
    const body = { ...f, slug: f.slug || undefined, description: f.description || null, parentId: f.parentId || null };
    const ok = await run(editing.id ? `/api/v1/admin/categories/${editing.id}` : '/api/v1/admin/categories', editing.id ? 'PUT' : 'POST', body, 'Category saved');
    if (ok) setEditing(null);
  };
  const set = (patch: Partial<CategoryForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button caps={false} size="sm" onClick={() => open()}>
          <Plus className="h-4 w-4" /> New category
        </Button>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Slug</Th>
            <Th>Products</Th>
            <Th>Order</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {ordered.map((c) => (
            <tr key={c.id} className="hover:bg-bone/50">
              <Td>
                <span className={c.parentId ? 'pl-6 text-ink/85 before:mr-2 before:text-faint before:content-["└"]' : 'font-medium'}>{c.name}</span>
                {c.isDemo ? <Badge tone="gold" className="ml-2">Demo</Badge> : null}
              </Td>
              <Td className="text-muted">/{c.slug}</Td>
              <Td className="tabular-nums">{c.productCount}</Td>
              <Td className="tabular-nums text-muted">{c.sortOrder}</Td>
              <Td>{c.isActive ? <Badge tone="success">Visible</Badge> : <Badge>Hidden</Badge>}</Td>
              <Td className="text-right">
                <button type="button" className="text-[13px] underline underline-offset-4" onClick={() => open(c)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="ml-4 text-[13px] text-danger underline underline-offset-4"
                  onClick={() => run(`/api/v1/admin/categories/${c.id}`, 'DELETE', undefined, 'Category deleted')}
                >
                  Delete
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog
        open={!!editing}
        onOpenChange={(o) => (o ? undefined : setEditing(null))}
        title={editing?.id ? 'Edit category' : 'New category'}
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button caps={false} onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <Field label="Name" required error={errors.name}>
              {(p) => <Input {...p} value={editing.form.name} onChange={(e) => set({ name: e.target.value })} />}
            </Field>
            <Field label="Slug" error={errors.slug} hint="Leave blank to generate from the name.">
              {(p) => <Input {...p} value={editing.form.slug} onChange={(e) => set({ slug: e.target.value })} />}
            </Field>
            <Field label="Parent" error={errors.parentId}>
              {(p) => (
                <Select {...p} value={editing.form.parentId} onChange={(e) => set({ parentId: e.target.value })}>
                  <option value="">None (top level)</option>
                  {roots
                    .filter((r) => r.id !== editing.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Description" error={errors.description}>
              {(p) => <Textarea {...p} rows={2} value={editing.form.description} onChange={(e) => set({ description: e.target.value })} />}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Sort order" error={errors.sortOrder}>
                {(p) => <Input {...p} inputMode="numeric" value={String(editing.form.sortOrder)} onChange={(e) => set({ sortOrder: Number(e.target.value.replace(/\D/g, '')) || 0 })} />}
              </Field>
              <div className="flex items-end pb-3">
                <Checkbox label="Visible in store" checked={editing.form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

// ─── Collections ──────────────────────────────────────────────────────────────

type CollectionRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  isDemo: boolean;
  productCount: number;
};
type CollectionForm = Omit<CollectionRow, 'id' | 'isDemo' | 'productCount' | 'description'> & { description: string };

export function CollectionManager({ collections }: { collections: CollectionRow[] }) {
  const { saving, errors, setErrors, run } = useSaver();
  const [editing, setEditing] = useState<{ id: string | null; form: CollectionForm } | null>(null);
  const open = (c?: CollectionRow) => {
    setErrors({});
    setEditing({
      id: c?.id ?? null,
      form: c
        ? { name: c.name, slug: c.slug, description: c.description ?? '', imageUrl: c.imageUrl, isFeatured: c.isFeatured, isActive: c.isActive, sortOrder: c.sortOrder }
        : { name: '', slug: '', description: '', imageUrl: null, isFeatured: false, isActive: true, sortOrder: 0 },
    });
  };
  const set = (patch: Partial<CollectionForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const save = async () => {
    if (!editing) return;
    const f = editing.form;
    const ok = await run(
      editing.id ? `/api/v1/admin/collections/${editing.id}` : '/api/v1/admin/collections',
      editing.id ? 'PUT' : 'POST',
      { ...f, slug: f.slug || undefined, description: f.description || null },
      'Collection saved',
    );
    if (ok) setEditing(null);
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button caps={false} size="sm" onClick={() => open()}>
          <Plus className="h-4 w-4" /> New collection
        </Button>
      </div>
      {collections.length === 0 ? (
        <EmptyState className="border border-line bg-paper" title="No collections yet" description="Group products into curated edits like “Eid 2026”." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {collections.map((c) => (
            <article key={c.id} className="border border-line bg-paper">
              <div className="relative aspect-[16/9] bg-linen">{c.imageUrl ? <Image src={c.imageUrl} alt="" fill sizes="400px" className="object-cover" /> : null}</div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-xl">{c.name}</h3>
                  <div className="flex gap-1">
                    {c.isFeatured ? <Badge tone="gold">Featured</Badge> : null}
                    {!c.isActive ? <Badge>Hidden</Badge> : null}
                    {c.isDemo ? <Badge tone="outline">Demo</Badge> : null}
                  </div>
                </div>
                <p className="mt-1 text-[12.5px] text-muted">
                  /{c.slug} · {c.productCount} products
                </p>
                <div className="mt-3 flex gap-4 text-[13px]">
                  <button type="button" className="underline underline-offset-4" onClick={() => open(c)}>
                    Edit
                  </button>
                  <button type="button" className="text-danger underline underline-offset-4" onClick={() => run(`/api/v1/admin/collections/${c.id}`, 'DELETE', undefined, 'Collection deleted')}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(o) => (o ? undefined : setEditing(null))}
        title={editing?.id ? 'Edit collection' : 'New collection'}
        description="Assign products to collections from the product editor."
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button caps={false} onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <Field label="Name" required error={errors.name}>
              {(p) => <Input {...p} value={editing.form.name} onChange={(e) => set({ name: e.target.value })} />}
            </Field>
            <Field label="Slug" error={errors.slug}>
              {(p) => <Input {...p} value={editing.form.slug} onChange={(e) => set({ slug: e.target.value })} />}
            </Field>
            <Field label="Description" error={errors.description}>
              {(p) => <Textarea {...p} rows={2} value={editing.form.description} onChange={(e) => set({ description: e.target.value })} />}
            </Field>
            <ImageField label="Cover image" value={editing.form.imageUrl} onChange={(url) => set({ imageUrl: url })} />
            <div className="flex flex-wrap gap-6">
              <Checkbox label="Featured on home page" checked={editing.form.isFeatured} onChange={(e) => set({ isFeatured: e.target.checked })} />
              <Checkbox label="Visible" checked={editing.form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

// ─── Sizes & colours ──────────────────────────────────────────────────────────

export function AttributeManager({
  sizes,
  colors,
}: {
  sizes: { id: string; label: string; sortOrder: number; usage: number }[];
  colors: { id: string; name: string; hex: string; usage: number }[];
}) {
  const { saving, errors, setErrors, run } = useSaver();
  const [size, setSize] = useState<{ id: string | null; label: string; sortOrder: number } | null>(null);
  const [color, setColor] = useState<{ id: string | null; name: string; hex: string } | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel
        title="Sizes"
        actions={
          <Button caps={false} size="sm" variant="outline" onClick={() => (setErrors({}), setSize({ id: null, label: '', sortOrder: (sizes.at(-1)?.sortOrder ?? 0) + 10 }))}>
            + Add size
          </Button>
        }
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-line text-[13.5px]">
          {sizes.map((s) => (
            <li key={s.id} className="flex items-center gap-4 px-5 py-2.5">
              <span className="w-20 font-medium">{s.label}</span>
              <span className="flex-1 text-[12px] text-muted">
                order {s.sortOrder} · used by {s.usage} variants
              </span>
              <button type="button" className="underline underline-offset-4" onClick={() => (setErrors({}), setSize({ id: s.id, label: s.label, sortOrder: s.sortOrder }))}>
                Edit
              </button>
              <button type="button" className="text-danger underline underline-offset-4 disabled:opacity-30" disabled={s.usage > 0} onClick={() => run(`/api/v1/admin/sizes/${s.id}`, 'DELETE', undefined, 'Size deleted')}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title="Colours"
        actions={
          <Button caps={false} size="sm" variant="outline" onClick={() => (setErrors({}), setColor({ id: null, name: '', hex: '#000000' }))}>
            + Add colour
          </Button>
        }
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-line text-[13.5px]">
          {colors.map((c) => (
            <li key={c.id} className="flex items-center gap-4 px-5 py-2.5">
              <span className="h-5 w-5 rounded-full border border-ink/15" style={{ backgroundColor: c.hex }} />
              <span className="w-28 font-medium">{c.name}</span>
              <span className="flex-1 text-[12px] text-muted">
                {c.hex} · {c.usage} variants
              </span>
              <button type="button" className="underline underline-offset-4" onClick={() => (setErrors({}), setColor({ id: c.id, name: c.name, hex: c.hex }))}>
                Edit
              </button>
              <button type="button" className="text-danger underline underline-offset-4 disabled:opacity-30" disabled={c.usage > 0} onClick={() => run(`/api/v1/admin/colors/${c.id}`, 'DELETE', undefined, 'Colour deleted')}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Dialog
        open={!!size}
        onOpenChange={(o) => (o ? undefined : setSize(null))}
        title={size?.id ? 'Edit size' : 'New size'}
        footer={
          <Button
            caps={false}
            loading={saving}
            onClick={async () => {
              if (!size) return;
              const ok = await run(size.id ? `/api/v1/admin/sizes/${size.id}` : '/api/v1/admin/sizes', size.id ? 'PUT' : 'POST', { label: size.label, sortOrder: size.sortOrder }, 'Size saved');
              if (ok) setSize(null);
            }}
          >
            Save
          </Button>
        }
      >
        {size ? (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Label" required error={errors.label}>
              {(p) => <Input {...p} value={size.label} onChange={(e) => setSize({ ...size, label: e.target.value })} />}
            </Field>
            <Field label="Sort order" error={errors.sortOrder}>
              {(p) => <Input {...p} inputMode="numeric" value={String(size.sortOrder)} onChange={(e) => setSize({ ...size, sortOrder: Number(e.target.value.replace(/\D/g, '')) || 0 })} />}
            </Field>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={!!color}
        onOpenChange={(o) => (o ? undefined : setColor(null))}
        title={color?.id ? 'Edit colour' : 'New colour'}
        footer={
          <Button
            caps={false}
            loading={saving}
            onClick={async () => {
              if (!color) return;
              const ok = await run(color.id ? `/api/v1/admin/colors/${color.id}` : '/api/v1/admin/colors', color.id ? 'PUT' : 'POST', { name: color.name, hex: color.hex }, 'Colour saved');
              if (ok) setColor(null);
            }}
          >
            Save
          </Button>
        }
      >
        {color ? (
          <div className="grid grid-cols-[1fr_auto] items-end gap-4">
            <Field label="Name" required error={errors.name}>
              {(p) => <Input {...p} value={color.name} onChange={(e) => setColor({ ...color, name: e.target.value })} />}
            </Field>
            <Field label="Swatch" error={errors.hex}>
              {(p) => <input {...p} type="color" value={color.hex} onChange={(e) => setColor({ ...color, hex: e.target.value })} className="h-11 w-16 cursor-pointer border border-line-strong bg-paper p-1" />}
            </Field>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
