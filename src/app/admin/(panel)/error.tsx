'use client';

import { Button } from '@/components/ui/button';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <p className="eyebrow text-gold-deep">Something went wrong</p>
      <h1 className="mt-4 font-display text-[36px] font-light leading-tight">This page could not be loaded.</h1>
      <p className="mt-3 text-[14px] text-muted">
        Nothing was changed. Try again; if it keeps happening, check the server logs{error.digest ? ` for reference ${error.digest}` : ''}.
      </p>
      <Button caps={false} className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
