'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { zodFieldErrors } from '@/lib/validation/common';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from '@/lib/validation/store';

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className="pr-11" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted hover:text-ink"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

type SessionCheck = { user: { id: string } | null; sessionCheck?: { sessionReceived: boolean; probeReceived: boolean } };

/**
 * After a successful sign-in, confirm the browser really kept the session cookie before moving on.
 * Some embedded previews, proxies and privacy settings drop cookies; without this check the next
 * page silently signs the user out again and the form appears to do nothing. Returns an error
 * message, or null when the session works.
 */
async function confirmSession(lead: string): Promise<string | null> {
  let probe: 'visible' | 'missing' | 'blocked';
  try {
    probe = document.cookie.split(';').some((c) => c.trim().startsWith('mkj_cookie_check=')) ? 'visible' : 'missing';
  } catch {
    probe = 'blocked'; // sandboxed frames without their own origin cannot use cookies at all
  }
  const result = await api<SessionCheck>(`/api/v1/auth/me?check=1&probe=${probe}`);
  if (result.ok && result.data.user) return null;
  if (!result.ok) return `${lead}, but we could not confirm your session. Please reload the page and try again.`;
  if (probe === 'visible' && !result.data.sessionCheck?.probeReceived) {
    return `${lead}, but cookies from this site are not reaching the server, so you would be signed out again on the next page. Something between your browser and the site (such as a preview proxy) is removing them.`;
  }
  return `${lead}, but this browser window did not keep the sign-in cookie, so you would be signed out again on the next page. Allow cookies for this site, or open it in a regular browser tab, and try again.`;
}

export function LoginForm({
  next,
  endpoint = '/api/v1/auth/login',
  registerHref,
  forgotHref,
}: {
  next: string;
  endpoint?: string;
  registerHref?: string;
  forgotHref?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    setLoading(true);
    const result = await api(endpoint, { body: parsed.data });
    if (!result.ok) {
      setLoading(false);
      if (result.error.fields) setErrors(result.error.fields);
      else setFormError(result.error.message);
      return;
    }
    const problem = await confirmSession('Your password was accepted');
    if (problem) {
      setLoading(false);
      setFormError(problem);
      return;
    }
    router.replace(next);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <Field label="Email" error={errors.email}>
        {(p) => <Input {...p} type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />}
      </Field>
      <div>
        <Field label="Password" error={errors.password}>
          {(p) => <PasswordInput {...p} autoComplete="current-password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />}
        </Field>
        {forgotHref ? (
          <p className="mt-2 text-right text-[13px]">
            <Link href={forgotHref} className="text-muted underline underline-offset-4 hover:text-ink">
              Forgot password?
            </Link>
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Sign in
      </Button>
      {registerHref ? (
        <p className="text-center text-[13.5px] text-muted">
          New to MKJ Store?{' '}
          <Link href={registerHref} className="text-ink underline underline-offset-4">
            Create an account
          </Link>
        </p>
      ) : null}
    </form>
  );
}

export function RegisterForm({ next, loginHref }: { next: string; loginHref: string }) {
  const router = useRouter();
  const [values, setValues] = useState({ name: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = registerSchema.safeParse({ ...values, phone: values.phone || undefined });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    setLoading(true);
    const result = await api('/api/v1/auth/register', { body: parsed.data });
    if (!result.ok) {
      setLoading(false);
      if (result.error.fields) setErrors(result.error.fields);
      else setFormError(result.error.message);
      return;
    }
    const problem = await confirmSession('Your account was created');
    if (problem) {
      setLoading(false);
      setFormError(problem);
      return;
    }
    router.replace(next);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <Field label="Full name" required error={errors.name}>
        {(p) => <Input {...p} autoComplete="name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />}
      </Field>
      <Field label="Email" required error={errors.email}>
        {(p) => <Input {...p} type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />}
      </Field>
      <Field label="Mobile number" error={errors.phone} hint="Optional — speeds up checkout and delivery.">
        {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />}
      </Field>
      <Field label="Password" required error={errors.password} hint="At least 8 characters, with a letter and a number.">
        {(p) => <PasswordInput {...p} autoComplete="new-password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Create account
      </Button>
      <p className="text-center text-[13.5px] text-muted">
        Already have an account?{' '}
        <Link href={loginHref} className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) return setError(zodFieldErrors(parsed.error).email ?? 'Enter a valid email.');
    setError(null);
    setLoading(true);
    const result = await api<{ message: string }>('/api/v1/auth/password/forgot', { body: parsed.data });
    setLoading(false);
    if (!result.ok) return setFormError(result.error.message);
    setSent(result.data.message);
  };

  if (sent) {
    return (
      <div className="space-y-5" role="status" aria-live="polite">
        <Alert tone="success" title="Check your inbox">
          {sent} The link expires soon and can be used once. Don’t forget to check your spam folder.
        </Alert>
        <p className="text-center text-[13.5px] text-muted">
          <Link href="/login" className="text-ink underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <Field label="Email" error={error ?? undefined}>
        {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Send reset link
      </Button>
      <p className="text-center text-[13.5px] text-muted">
        Remembered it?{' '}
        <Link href="/login" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [values, setValues] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = resetPasswordSchema.safeParse({ token, password: values.password });
    const fieldErrors = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (values.password !== values.confirm) fieldErrors.confirm = 'The passwords do not match.';
    if (!parsed.success || fieldErrors.confirm) return setErrors(fieldErrors);
    setErrors({});
    setLoading(true);
    const result = await api('/api/v1/auth/password/reset', { body: parsed.data });
    if (!result.ok) {
      setLoading(false);
      if (result.error.fields) setErrors(result.error.fields);
      else setFormError(result.error.message);
      return;
    }
    const problem = await confirmSession('Your password was changed');
    if (problem) {
      setLoading(false);
      setFormError(problem);
      return;
    }
    router.replace('/account?password=reset');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError ? (
        <Alert tone="danger">
          {formError}{' '}
          <Link href="/forgot-password" className="underline underline-offset-4">
            Request a new link
          </Link>
        </Alert>
      ) : null}
      {errors.token ? <Alert tone="danger">{errors.token}</Alert> : null}
      <Field label="New password" required error={errors.password} hint="At least 8 characters, with a letter and a number.">
        {(p) => <PasswordInput {...p} autoComplete="new-password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />}
      </Field>
      <Field label="Confirm new password" required error={errors.confirm}>
        {(p) => <PasswordInput {...p} autoComplete="new-password" value={values.confirm} onChange={(e) => setValues({ ...values, confirm: e.target.value })} />}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Set new password
      </Button>
    </form>
  );
}
