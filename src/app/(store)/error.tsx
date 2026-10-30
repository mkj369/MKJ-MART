'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="container-x flex flex-col items-center py-28 text-center">
      <p className="eyebrow text-gold-deep">Something went wrong</p>
      <h1 className="mt-4 font-display text-[42px] font-light leading-tight">We couldn’t load this page.</h1>
      <p className="mt-3 max-w-md text-[15px] text-muted">
        Please try again in a moment. If the problem continues, contact customer care{error.digest ? ` and mention reference ${error.digest}` : ''}.
      </p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
