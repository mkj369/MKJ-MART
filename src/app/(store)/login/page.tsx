import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/store/auth-shell';
import { LoginForm } from '@/components/store/auth-forms';
import { getCurrentUser } from '@/server/auth/current-user';
import { safeRedirectPath } from '@/lib/utils';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeRedirectPath(typeof sp.next === 'string' ? sp.next : null, '/account');
  if (await getCurrentUser()) redirect(next);
  return (
    <AuthShell eyebrow="Welcome back" title="Sign in" subtitle="Track orders, save addresses and keep a wishlist.">
      <LoginForm next={next} registerHref={`/register?next=${encodeURIComponent(next)}`} />
    </AuthShell>
  );
}
