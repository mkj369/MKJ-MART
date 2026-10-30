'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api-client';

/** Single-image picker backed by the admin upload endpoint. */
export function ImageField({ value, onChange, label = 'Image' }: { value: string | null; onChange: (url: string | null) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    const result = await api<{ url: string }>('/api/v1/admin/uploads', { form, method: 'POST' });
    setUploading(false);
    if (!result.ok) return toast.error(result.error.message);
    onChange(result.data.url);
  };
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink/80">{label}</p>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      {value ? (
        <div className="relative aspect-[4/3] w-40 bg-linen">
          <Image src={value} alt="" fill sizes="160px" className="object-cover" />
          <button type="button" onClick={() => onChange(null)} className="absolute right-1.5 top-1.5 bg-paper/90 p-1 text-danger" aria-label="Remove image">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} className="flex aspect-[4/3] w-40 flex-col items-center justify-center gap-1.5 border border-dashed border-line-strong text-[12px] text-muted hover:border-ink hover:text-ink">
          {uploading ? <Spinner className="h-5 w-5" /> : <ImagePlus className="h-5 w-5" strokeWidth={1.3} />}
          Upload
        </button>
      )}
    </div>
  );
}
