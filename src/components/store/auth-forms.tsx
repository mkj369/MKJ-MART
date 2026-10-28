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
import { loginSchema, registerSchema } from '@/lib/validation/store';

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

export function LoginForm({ next, endpoint = '/api/v1/auth/login', registerHref }: { next: string; endpoint?: string; registerHref?: string }) {
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
    router.replace(next);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <Field label="Email" error={errors.email}>
        {(p) => <Input {...p} type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />}
      </Field>
      <Field label="Password" error={errors.password}>
        {(p) => <PasswordInput {...p} autoComplete="current-password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />}
      </Field>
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
