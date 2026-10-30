import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/store/auth-shell';
import { RegisterForm } from '@/components/store/auth-forms';
import { getCurrentUser } from '@/server/auth/current-user';
import { safeRedirectPath } from '@/lib/utils';

export const metadata: Metadata = { title: 'Create an account' };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeRedirectPath(typeof sp.next === 'string' ? sp.next : null, '/account');
  if (await getCurrentUser()) redirect(next);
  return (
    <AuthShell eyebrow="Join MKJ Store" title="Create an account" subtitle="Your bag is saved and merged when you sign up.">
      <RegisterForm next={next} loginHref={`/login?next=${encodeURIComponent(next)}`} />
    </AuthShell>
  );
}
