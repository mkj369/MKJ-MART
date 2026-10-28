import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { bengali, cormorant, jost, taka } from './fonts';
import './globals.css';

// Every page depends on the session, live prices and stock — always render per request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'MKJ Store — Considered clothing, made in Bangladesh',
    template: '%s · MKJ Store',
  },
  description:
    'MKJ Store: panjabis, shirts, tailoring and accessories crafted in Bangladesh. Cash on Delivery across all 64 districts.',
  applicationName: 'MKJ MART',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0e0e0e',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-BD"
      className={`${jost.variable} ${cormorant.variable} ${taka.variable} ${bengali.variable}`}
      data-scroll-behavior="smooth"
    >
      <body className="min-h-dvh">
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            classNames: {
              toast: '!rounded-none !border-ink !bg-ink !text-paper !font-sans !shadow-xl',
              description: '!text-paper/70',
              actionButton: '!bg-paper !text-ink !rounded-none',
            },
          }}
        />
      </body>
    </html>
  );
}
