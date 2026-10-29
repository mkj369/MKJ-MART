import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/store/auth-shell';
import { ResetPasswordForm } from '@/components/store/auth-forms';
import { Alert } from '@/components/ui/feedback';
import { buttonClasses } from '@/components/ui/button';
import { isResetTokenValid } from '@/server/services/auth';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : '';
  const valid = await isResetTokenValid(token);
  return (
    <AuthShell eyebrow="Account help" title="Choose a new password" subtitle="For your security, you will be signed out on all other devices.">
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-5">
          <Alert tone="warning" title="This link has expired or was already used">
            Reset links work once and only for a short time. Request a new one below.
          </Alert>
          <Link href="/forgot-password" className={buttonClasses({ size: 'lg', className: 'w-full' })}>
            Request a new link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
