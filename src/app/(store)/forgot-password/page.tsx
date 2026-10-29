import type { Metadata } from 'next';
import { AuthShell } from '@/components/store/auth-shell';
import { ForgotPasswordForm } from '@/components/store/auth-forms';

export const metadata: Metadata = { title: 'Forgot password', robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthShell eyebrow="Account help" title="Forgot your password?" subtitle="Enter the email you use for your account and we’ll send you a link to choose a new one.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
