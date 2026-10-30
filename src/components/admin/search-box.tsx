'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Spinner } from '@/components/ui/feedback';

/** URL-synced search input for admin lists (resets pagination). */
export function SearchBox({ placeholder = 'Search…', param = 'q' }: { placeholder?: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(param) ?? '');
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set(param, value.trim());
    else params.delete(param);
    params.delete('page');
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full border border-line-strong bg-paper pl-9 pr-9 text-[13.5px] focus:border-ink focus:outline-none"
      />
      {pending ? <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /> : null}
    </form>
  );
}
