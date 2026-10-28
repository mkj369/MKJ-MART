import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { Alert } from '@/components/ui/feedback';
import { LoginForm } from '@/components/store/auth-forms';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasDemoCatalog } from '@/server/services/catalog';
import { isStaffRole } from '@/lib/permissions';
import { safeRedirectPath } from '@/lib/utils';

export const metadata: Metadata = { title: 'Admin sign in', robots: { index: false } };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeRedirectPath(typeof sp.next === 'string' ? sp.next : null, '/admin');
  const target = next.startsWith('/admin') ? next : '/admin';
  const user = await getCurrentUser();
  if (user && isStaffRole(user.role)) redirect(target);
  const demo = await hasDemoCatalog();

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-ink p-12 text-paper lg:flex">
        <Logo inverted className="items-start [&>span:first-child]:[margin-right:0]" />
        <div>
          <p className="eyebrow text-gold-light">MKJ MART · Back office</p>
          <p className="mt-5 max-w-md font-display text-[40px] font-light leading-[1.1]">Orders, stock and customers — in one considered place.</p>
        </div>
        <p className="text-[12px] text-paper/40">Part of the MKJ Ecosystem</p>
      </div>
      <div className="flex items-center justify-center bg-paper px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <p className="eyebrow text-gold-deep">Staff only</p>
          <h1 className="mt-3 font-display text-[40px] font-light leading-none">Admin sign in</h1>
          {sp.denied ? (
            <Alert tone="warning" className="mt-6">
              Your account does not have access to the admin panel. Sign in with a staff account.
            </Alert>
          ) : null}
          <div className="mt-8">
            <LoginForm next={target} endpoint="/api/v1/admin/auth/login" />
          </div>
          {demo ? (
            <div className="mt-8 border border-gold-light bg-[#faf6ee] p-4 text-[12.5px] leading-relaxed text-gold-deep" data-testid="demo-credentials">
              <p className="font-medium uppercase tracking-[0.12em]">Demo accounts</p>
              <p className="mt-1.5">Admin: admin@mkjmart.demo / Admin@12345</p>
              <p>Staff: staff@mkjmart.demo / Staff@12345</p>
              <p className="mt-1.5 opacity-80">Shown only while demo data exists. Purge it in Settings → Demo data before launch.</p>
            </div>
          ) : null}
          <p className="mt-10 text-[13px] text-muted">
            <Link href="/" className="underline underline-offset-4 hover:text-ink">
              ← Back to the store
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
