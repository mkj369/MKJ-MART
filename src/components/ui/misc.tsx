import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { discountPercent, formatBDT } from '@/lib/money';
import { cn } from '@/lib/utils';

export function Price({
  price,
  compareAtPrice,
  className,
  size = 'md',
}: {
  price: number;
  compareAtPrice?: number | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const onSale = !!compareAtPrice && compareAtPrice > price;
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2 tabular-nums', className)}>
      <span
        className={cn(
          size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-[13px]' : 'text-[14.5px]',
          onSale ? 'text-danger' : 'text-ink',
          'font-medium',
        )}
      >
        {formatBDT(price)}
      </span>
      {onSale ? (
        <>
          <span className={cn('text-muted line-through decoration-1', size === 'lg' ? 'text-base' : 'text-[12.5px]')}>
            {formatBDT(compareAtPrice!)}
          </span>
          {size === 'lg' ? (
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-danger">Save {discountPercent(price, compareAtPrice)}%</span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

/** Server-rendered pagination using links, so pages are crawlable and work without JavaScript. */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  className,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const pages: (number | '…')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  const item = 'flex h-10 min-w-10 items-center justify-center border px-3 text-sm tabular-nums transition-colors';
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-center gap-1.5', className)}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(item, 'border-line hover:border-ink')} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Link>
      ) : null}
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-2 text-muted">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(item, p === page ? 'border-ink bg-ink text-paper' : 'border-line hover:border-ink')}
          >
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={cn(item, 'border-line hover:border-ink')} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : null}
    </nav>
  );
}

export function Breadcrumbs({ items, className }: { items: { label: string; href?: string }[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('text-[12px] text-muted', className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? <span aria-hidden="true" className="text-line-strong">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="transition-colors hover:text-ink">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Renders admin-authored policy text safely (no HTML): "## " headings, "- " bullets, paragraphs. */
export function RichText({ text, className, headingAs = 'h2' }: { text: string; className?: string; headingAs?: 'h2' | 'h3' }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const Heading = headingAs;
  return (
    <div className={cn('space-y-4 text-[15px] leading-[1.75] text-ink/85', className)}>
      {blocks.map((block, i) => {
        if (block.startsWith('## ')) {
          return (
            <Heading key={i} className="pt-4 font-display text-[26px] font-medium text-ink first:pt-0">
              {block.slice(3)}
            </Heading>
          );
        }
        const lines = block.split('\n');
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={i} className="space-y-1.5 pl-1">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-3">
                  <span className="mt-[11px] h-px w-3 shrink-0 bg-gold" aria-hidden="true" />
                  <span>{l.slice(2)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </div>
  );
}
