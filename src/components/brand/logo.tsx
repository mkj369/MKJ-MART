import { cn } from '@/lib/utils';

/** MKJ Store wordmark: tracked serif monogram over a gold hairline and a small "STORE" label. */
export function Logo({ className, inverted = false, compact = false }: { className?: string; inverted?: boolean; compact?: boolean }) {
  return (
    <span className={cn('inline-flex flex-col items-center leading-none', inverted ? 'text-paper' : 'text-ink', className)}>
      <span className="font-display text-[28px] font-semibold tracking-[0.32em] [margin-right:-0.32em]">MKJ</span>
      {compact ? null : (
        <>
          <span className="mt-1 h-px w-10 bg-gold" aria-hidden="true" />
          <span className="mt-1 text-[8.5px] font-medium tracking-[0.55em] [margin-right:-0.55em]">STORE</span>
        </>
      )}
    </span>
  );
}
