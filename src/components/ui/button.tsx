import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './feedback';

const VARIANTS = {
  primary: 'bg-ink text-paper hover:bg-ink-soft',
  secondary: 'border border-ink bg-transparent text-ink hover:bg-ink hover:text-paper',
  outline: 'border border-line-strong bg-paper text-ink hover:border-ink',
  ghost: 'bg-transparent text-ink hover:bg-bone',
  gold: 'bg-gold text-paper hover:bg-gold-deep',
  light: 'bg-paper text-ink hover:bg-bone',
  danger: 'bg-danger text-paper hover:bg-danger/90',
  'danger-outline': 'border border-danger/40 bg-paper text-danger hover:bg-danger-soft',
  link: 'bg-transparent px-0 text-ink underline-offset-4 hover:underline',
} as const;

const SIZES = {
  sm: 'h-9 px-4 text-[11px]',
  md: 'h-11 px-6 text-[12px]',
  lg: 'h-13 px-8 text-[12.5px]',
  icon: 'h-10 w-10 p-0',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  caps = true,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; caps?: boolean; className?: string } = {}) {
  return cn(
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,opacity] duration-300 ease-[var(--ease-luxe)] disabled:pointer-events-none disabled:opacity-45',
    caps ? 'uppercase tracking-[0.16em]' : 'text-[13px] tracking-normal normal-case',
    VARIANTS[variant],
    SIZES[size],
    variant === 'link' && 'h-auto',
    className,
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  caps?: boolean;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, caps, loading, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, caps, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="h-4 w-4" /> : null}
      <span className={cn('inline-flex items-center gap-2', loading && 'opacity-80')}>{children}</span>
    </button>
  );
});
