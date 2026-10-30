'use client';

/** Last-resort error page (the root layout itself failed). Kept dependency-free on purpose. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Helvetica, Arial, sans-serif', background: '#f7f5f0', color: '#0e0e0e' }}>
        <main style={{ maxWidth: 520, margin: '18vh auto', padding: '0 24px', textAlign: 'center' }}>
          <p style={{ letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: 12, color: '#84653a' }}>MKJ Store</p>
          <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 300, fontSize: 36 }}>We’re having trouble right now.</h1>
          <p style={{ color: '#6b665e' }}>Please try again in a moment{error.digest ? ` (reference ${error.digest})` : ''}.</p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 24, background: '#0e0e0e', color: '#fff', border: 0, padding: '12px 24px', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
