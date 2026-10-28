import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/components/store/account-forms';
import { requireCustomerPage } from '@/server/auth/current-user';

export const metadata: Metadata = { title: 'Password & security' };

export default async function SecurityPage() {
  await requireCustomerPage('/account/security');
  return (
    <section className="max-w-xl">
      <h2 className="eyebrow border-b border-line pb-3">Change password</h2>
      <p className="mt-5 text-[13.5px] text-muted">For your security, changing your password signs you out on all other devices.</p>
      <div className="mt-6">
        <ChangePasswordForm />
      </div>
    </section>
  );
}
