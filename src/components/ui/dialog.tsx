'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Accessible modal (focus trap, Esc, scroll lock) built on Radix Dialog. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col bg-paper shadow-2xl focus:outline-none data-[state=open]:animate-fade-up',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
            <div>
              <RadixDialog.Title className="font-display text-2xl font-medium leading-tight">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm text-muted">{description}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">Dialog</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close className="-mr-2 -mt-1 p-2 text-muted transition-colors hover:text-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="flex justify-end gap-3 border-t border-line px-6 py-4">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Slide-in panel (cart drawer, mobile menu, filters). */
export function Sheet({
  open,
  onOpenChange,
  side = 'right',
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'left' | 'right';
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink/35 data-[state=open]:animate-fade-in" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-y-0 z-50 flex w-full max-w-[440px] flex-col bg-paper shadow-2xl transition-transform duration-500 ease-[var(--ease-luxe)] focus:outline-none',
            side === 'right' ? 'right-0 data-[state=open]:animate-[sheet-in-right_0.5s_var(--ease-luxe)]' : 'left-0 data-[state=open]:animate-[sheet-in-left_0.5s_var(--ease-luxe)]',
            className,
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-6 py-5">
            <RadixDialog.Title className="eyebrow">{title}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">Panel</RadixDialog.Description>
            <RadixDialog.Close className="-mr-2 p-2 text-muted transition-colors hover:text-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? <div className="border-t border-line px-6 py-5">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
