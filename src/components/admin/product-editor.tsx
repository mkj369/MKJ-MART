'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Trash2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Spinner } from '@/components/ui/feedback';
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { slugify } from '@/lib/utils';
import { productInputSchema } from '@/lib/validation/admin';
import { zodFieldErrors } from '@/lib/validation/common';
import { Panel } from './ui';

type Options = {
  categories: { id: string; name: string }[];
  collections: { id: string; name: string }[];
  sizes: { id: string; label: string }[];
  colors: { id: string; name: string; hex: string }[];
};

type ImageRow = { id?: string; url: string; alt: string; colorId: string | null };
type VariantRow = { key: string; id?: string; sku: string; sizeId: string | null; colorId: string | null; stock: number; stockBaseline?: number; isActive: boolean };

export type EditableProduct = {
  id: string;
  name: string;
  slug: string;
  description: string;
  material: string;
  careInstructions: string;
  categoryId: string | null;
  price: number;
  compareAtPrice: number | null;
  status: 'draft' | 'active' | 'archived';
  isFeatured: boolean;
  tags: string[];
  collectionIds: string[];
  images: ImageRow[];
  variants: Omit<VariantRow, 'key'>[];
};

let keySeq = 0;
const nextKey = () => `v${++keySeq}`;

export function ProductEditor({ options, product }: { options: Options; product?: EditableProduct }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(product?.name ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!product);
  const [description, setDescription] = useState(product?.description ?? '');
  const [material, setMaterial] = useState(product?.material ?? '');
  const [care, setCare] = useState(product?.careInstructions ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(product?.categoryId ?? null);
  const [price, setPrice] = useState<number | null>(product?.price ?? null);
  const [compareAt, setCompareAt] = useState<number | null>(product?.compareAtPrice ?? null);
  const [status, setStatus] = useState<EditableProduct['status']>(product?.status ?? 'draft');
  const [featured, setFeatured] = useState(product?.isFeatured ?? false);
  const [tags, setTags] = useState((product?.tags ?? []).join(', '));
  const [collectionIds, setCollectionIds] = useState<string[]>(product?.collectionIds ?? []);
  const [images, setImages] = useState<ImageRow[]>(product?.images ?? []);
  const [variants, setVariants] = useState<VariantRow[]>(
    (product?.variants ?? [{ sku: '', sizeId: null, colorId: null, stock: 0, isActive: true }]).map((v) => ({ ...v, key: nextKey() })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [generator, setGenerator] = useState<{ open: boolean; sizes: string[]; colors: string[]; stock: number }>({ open: false, sizes: [], colors: [], stock: 0 });

  const skuBase = (slug || slugify(name)).toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24) || 'SKU';
  const labelOf = (id: string | null, list: { id: string; label?: string; name?: string }[]) => list.find((x) => x.id === id)?.label ?? list.find((x) => x.id === id)?.name ?? '';

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files).slice(0, 12 - images.length)) {
      setUploading((n) => n + 1);
      const form = new FormData();
      form.append('file', file);
      const result = await api<{ url: string }>('/api/v1/admin/uploads', { form, method: 'POST' });
      setUploading((n) => n - 1);
      if (!result.ok) {
        toast.error(`${file.name}: ${result.error.message}`);
        continue;
      }
      setImages((list) => [...list, { url: result.data.url, alt: name, colorId: null }]);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const move = (index: number, delta: number) =>
    setImages((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const generate = () => {
    const sizes = generator.sizes.length ? generator.sizes : [null];
    const colors = generator.colors.length ? generator.colors : [null];
    const existing = new Set(variants.map((v) => `${v.sizeId}|${v.colorId}`));
    const created: VariantRow[] = [];
    for (const colorId of colors) {
      for (const sizeId of sizes) {
        if (existing.has(`${sizeId}|${colorId}`)) continue;
        const parts = [skuBase, colorId ? labelOf(colorId, options.colors).slice(0, 3).toUpperCase() : null, sizeId ? labelOf(sizeId, options.sizes).replace(/\s+/g, '').toUpperCase() : null].filter(Boolean);
        created.push({ key: nextKey(), sku: parts.join('-'), sizeId, colorId, stock: generator.stock, isActive: true });
      }
    }
    setVariants((list) => [...list.filter((v) => v.sku || v.sizeId || v.colorId || v.id), ...created]);
    setGenerator((g) => ({ ...g, open: false }));
    if (!created.length) toast('All of those combinations already exist.');
  };

  const save = async () => {
    const payload = {
      name,
      slug: slug || undefined,
      description,
      material: material || null,
      careInstructions: care || null,
      categoryId,
      price: price ?? NaN,
      compareAtPrice: compareAt,
      status,
      isFeatured: featured,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      collectionIds,
      images: images.map(({ id, url, alt, colorId }) => ({ id, url, alt, colorId })),
      variants: variants.map(({ key: _k, ...v }) => v),
    };
    const parsed = productInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    const result = product
      ? await api<{ id: string }>(`/api/v1/admin/products/${product.id}`, { method: 'PUT', body: payload })
      : await api<{ id: string }>('/api/v1/admin/products', { body: payload });
    setSaving(false);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      toast.error(result.error.message);
      return;
    }
    toast(product ? 'Product saved' : 'Product created');
    if (!product) router.replace(`/admin/products/${result.data.id}`);
    router.refresh();
  };

  const remove = async () => {
    if (!product) return;
    setSaving(true);
    const result = await api(`/api/v1/admin/products/${product.id}`, { method: 'DELETE' });
    setSaving(false);
    setDeleteOpen(false);
    if (!result.ok) return toast.error(result.error.message);
    toast('Product deleted');
    router.replace('/admin/products');
    router.refresh();
  };

  const variantError = (i: number, field: string) => errors[`variants.${i}.${field}`];

  return (
    <div className="grid gap-6 pb-24 xl:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {Object.keys(errors).length ? <Alert tone="danger" title="Some fields need attention">{errors.variants ?? errors.images ?? 'Check the highlighted fields below.'}</Alert> : null}

        <Panel title="Details">
          <div className="grid gap-5">
            <Field label="Name" required error={errors.name}>
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                />
              )}
            </Field>
            <Field label="URL slug" error={errors.slug} hint={`URL: /products/${slug || 'your-product'}`}>
              {(p) => (
                <Input
                  {...p}
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
              )}
            </Field>
            <Field label="Description" error={errors.description}>
              {(p) => <Textarea {...p} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />}
            </Field>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Material" error={errors.material}>
                {(p) => <Input {...p} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. 100% cotton" />}
              </Field>
              <Field label="Care" error={errors.careInstructions}>
                {(p) => <Input {...p} value={care} onChange={(e) => setCare(e.target.value)} placeholder="e.g. Machine wash cold" />}
              </Field>
            </div>
          </div>
        </Panel>

        <Panel
          title={`Images (${images.length}/12)`}
          actions={
            <>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
              <Button caps={false} size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={images.length >= 12}>
                {uploading ? <Spinner className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />} Upload
              </Button>
            </>
          }
        >
          {errors.images ? <p className="mb-3 text-[12.5px] text-danger">{errors.images}</p> : null}
          {images.length === 0 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 border border-dashed border-line-strong py-12 text-[13px] text-muted hover:border-ink hover:text-ink"
            >
              <ImagePlus className="h-6 w-6" strokeWidth={1.3} />
              Upload JPEG, PNG or WebP (max 8 MB). Images are optimised to WebP automatically.
            </button>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((img, i) => (
                <li key={img.url} className="border border-line">
                  <div className="relative aspect-[3/4] bg-linen">
                    <Image src={img.url} alt={img.alt} fill sizes="240px" className="object-cover" />
                    {i === 0 ? <span className="absolute left-2 top-2 bg-ink px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-paper">Cover</span> : null}
                    <div className="absolute right-2 top-2 flex gap-1">
                      <button type="button" className="bg-paper/90 p-1.5 disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className="bg-paper/90 p-1.5 disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label="Move later">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className="bg-paper/90 p-1.5 text-danger" onClick={() => setImages((l) => l.filter((_, j) => j !== i))} aria-label="Remove image">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 p-3">
                    <Input className="h-9 text-[13px]" value={img.alt} placeholder="Alt text" aria-label="Alt text" onChange={(e) => setImages((l) => l.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} />
                    <Select className="h-9 text-[13px]" value={img.colorId ?? ''} aria-label="Colour" onChange={(e) => setImages((l) => l.map((x, j) => (j === i ? { ...x, colorId: e.target.value || null } : x)))}>
                      <option value="">All colours</option>
                      {options.colors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={`Variants (${variants.length})`}
          actions={
            <div className="flex gap-2">
              <Button caps={false} size="sm" variant="outline" onClick={() => setGenerator((g) => ({ ...g, open: true }))}>
                <Wand2 className="h-4 w-4" /> Generate
              </Button>
              <Button caps={false} size="sm" variant="outline" onClick={() => setVariants((l) => [...l, { key: nextKey(), sku: '', sizeId: null, colorId: null, stock: 0, isActive: true }])}>
                + Add
              </Button>
            </div>
          }
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-bone/60 text-left text-[10.5px] uppercase tracking-[0.12em] text-muted">
                  <th className="px-4 py-2.5 font-medium">Colour</th>
                  <th className="px-4 py-2.5 font-medium">Size</th>
                  <th className="px-4 py-2.5 font-medium">SKU</th>
                  <th className="px-4 py-2.5 font-medium">Stock</th>
                  <th className="px-4 py-2.5 font-medium">Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => {
                  const update = (patch: Partial<VariantRow>) => setVariants((l) => l.map((x) => (x.key === v.key ? { ...x, ...patch } : x)));
                  return (
                    <tr key={v.key} className="border-b border-line align-top last:border-0">
                      <td className="px-4 py-2.5">
                        <Select className="h-9 text-[13px]" value={v.colorId ?? ''} aria-label="Colour" onChange={(e) => update({ colorId: e.target.value || null })}>
                          <option value="">—</option>
                          {options.colors.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-4 py-2.5">
                        <Select className="h-9 text-[13px]" value={v.sizeId ?? ''} aria-label="Size" aria-invalid={variantError(i, 'sizeId') ? true : undefined} onChange={(e) => update({ sizeId: e.target.value || null })}>
                          <option value="">—</option>
                          {options.sizes.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </Select>
                        {variantError(i, 'sizeId') ? <p className="mt-1 text-[11.5px] text-danger">{variantError(i, 'sizeId')}</p> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <Input className="h-9 text-[13px] uppercase" value={v.sku} aria-label="SKU" aria-invalid={variantError(i, 'sku') ? true : undefined} onChange={(e) => update({ sku: e.target.value })} />
                        {variantError(i, 'sku') ? <p className="mt-1 text-[11.5px] text-danger">{variantError(i, 'sku')}</p> : null}
                      </td>
                      <td className="w-28 px-4 py-2.5">
                        <Input className="h-9 text-[13px] tabular-nums" inputMode="numeric" value={String(v.stock)} aria-label="Stock" onChange={(e) => update({ stock: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
                        {variantError(i, 'stock') ? <p className="mt-1 text-[11.5px] text-danger">{variantError(i, 'stock')}</p> : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <input type="checkbox" className="h-4 w-4" checked={v.isActive} onChange={(e) => update({ isActive: e.target.checked })} aria-label="Active" />
                      </td>
                      <td className="px-2 py-2.5">
                        <button type="button" className="p-2 text-muted hover:text-danger" onClick={() => setVariants((l) => l.filter((x) => x.key !== v.key))} aria-label="Remove variant" disabled={variants.length === 1}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-[12px] text-muted">
            Stock edits are recorded in the inventory ledger. Variants that appear in past orders are deactivated instead of deleted.
          </p>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Publishing">
          <div className="space-y-4">
            <Field label="Status" error={errors.status}>
              {(p) => (
                <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as EditableProduct['status'])}>
                  <option value="draft">Draft — hidden</option>
                  <option value="active">Active — visible in store</option>
                  <option value="archived">Archived — hidden, kept for history</option>
                </Select>
              )}
            </Field>
            <Checkbox label="Feature on the home page" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
          </div>
        </Panel>
        <Panel title="Pricing (BDT)">
          <div className="space-y-4">
            <Field label="Price" required error={errors.price}>
              {(p) => <MoneyInput {...p} value={price} onChange={setPrice} />}
            </Field>
            <Field label="Compare-at price" error={errors.compareAtPrice} hint="Original price, shown struck through when on sale.">
              {(p) => <MoneyInput {...p} value={compareAt} onChange={setCompareAt} />}
            </Field>
          </div>
        </Panel>
        <Panel title="Organisation">
          <div className="space-y-4">
            <Field label="Category" error={errors.categoryId}>
              {(p) => (
                <Select {...p} value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
                  <option value="">Uncategorised</option>
                  {options.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink/80">Collections</p>
              <div className="space-y-2">
                {options.collections.map((c) => (
                  <Checkbox
                    key={c.id}
                    label={c.name}
                    checked={collectionIds.includes(c.id)}
                    onChange={(e) => setCollectionIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                  />
                ))}
              </div>
            </div>
            <Field label="Tags" hint="Comma-separated; used by search." error={errors.tags}>
              {(p) => <Input {...p} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cotton, eid, festive" />}
            </Field>
          </div>
        </Panel>
        {product ? (
          <Panel title="Danger zone">
            <p className="text-[12.5px] text-muted">Products with past orders can’t be deleted — archive them instead.</p>
            <Button caps={false} size="sm" variant="danger-outline" className="mt-3" onClick={() => setDeleteOpen(true)}>
              Delete product
            </Button>
          </Panel>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur lg:left-[256px]">
        <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 md:px-8 lg:px-10">
          <Button caps={false} variant="outline" onClick={() => router.push('/admin/products')}>
            Cancel
          </Button>
          <Button caps={false} onClick={save} loading={saving} disabled={uploading > 0} data-testid="save-product">
            {product ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </div>

      <Dialog
        open={generator.open}
        onOpenChange={(o) => setGenerator((g) => ({ ...g, open: o }))}
        title="Generate variants"
        description="Creates one variant for every colour × size combination (existing ones are skipped)."
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setGenerator((g) => ({ ...g, open: false }))}>
              Cancel
            </Button>
            <Button caps={false} onClick={generate}>
              Generate
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em]">Colours</p>
            <div className="flex flex-wrap gap-2">
              {options.colors.map((c) => {
                const on = generator.colors.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => setGenerator((g) => ({ ...g, colors: on ? g.colors.filter((x) => x !== c.id) : [...g.colors, c.id] }))} className={`flex items-center gap-2 border px-2.5 py-1.5 text-[12.5px] ${on ? 'border-ink bg-bone' : 'border-line'}`}>
                    <span className="h-3.5 w-3.5 rounded-full border border-ink/15" style={{ backgroundColor: c.hex }} />
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em]">Sizes</p>
            <div className="flex flex-wrap gap-2">
              {options.sizes.map((s) => {
                const on = generator.sizes.includes(s.id);
                return (
                  <button key={s.id} type="button" onClick={() => setGenerator((g) => ({ ...g, sizes: on ? g.sizes.filter((x) => x !== s.id) : [...g.sizes, s.id] }))} className={`min-w-10 border px-2.5 py-1.5 text-[12.5px] ${on ? 'border-ink bg-ink text-paper' : 'border-line'}`}>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Opening stock per variant">
            {(p) => <Input {...p} inputMode="numeric" value={String(generator.stock)} onChange={(e) => setGenerator((g) => ({ ...g, stock: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) }))} />}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this product?"
        description="This permanently removes the product, its variants and images."
        footer={
          <>
            <Button caps={false} variant="outline" onClick={() => setDeleteOpen(false)}>
              Keep
            </Button>
            <Button caps={false} variant="danger" onClick={remove} loading={saving}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-muted">If the product has been ordered before, deletion is blocked and you’ll be asked to archive it.</p>
      </Dialog>
    </div>
  );
}
