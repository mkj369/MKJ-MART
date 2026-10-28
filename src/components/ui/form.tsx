import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full border border-line-strong bg-paper px-3.5 text-[15px] text-ink placeholder:text-faint transition-colors duration-200 focus:border-ink focus:outline-none disabled:bg-bone disabled:text-muted aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, 'h-11', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(control, 'py-2.5 leading-relaxed', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, 'select-chevron h-11', className)} {...props}>
      {children}
    </select>
  );
});

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink/80', className)} {...props}>
      {children}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-[12.5px] text-danger" role="alert">
      {children}
    </p>
  );
}

/**
 * Label + control + hint + error, wired for accessibility. `children` receives the generated id and
 * aria props so any control can be used.
 */
export function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; required?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="ml-0.5 text-gold-deep" aria-hidden="true">*</span> : null}
      </Label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, required })}
      {hint && !error ? (
        <p id={hintId} className="mt-1.5 text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 text-sm', className)}>
      <input type="checkbox" className="mt-[3px] h-4 w-4 shrink-0 cursor-pointer" {...props} />
      <span>
        <span className="text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-[13px] text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** Taka amount input that edits whole/decimal taka but reports integer poisha. */
export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | null;
  onChange: (poisha: number | null) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">৳</span>
      <input
        inputMode="decimal"
        className={cn(control, 'h-11 pl-8 tabular-nums', className)}
        value={value === null ? '' : String(value / 100)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, '');
          if (raw === '') return onChange(null);
          const n = Math.round(Number(raw) * 100);
          if (Number.isFinite(n)) onChange(n);
        }}
        {...props}
      />
    </div>
  );
}
