'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api-client';
import { zodFieldErrors } from '@/lib/validation/common';
import { SUPPORT_TOPIC_LABEL, SUPPORT_TOPICS, supportRequestSchema, type SupportTopic } from '@/lib/validation/store';

export function SupportForm({ defaults }: { defaults: { name: string; email: string; phone: string; orderNumber: string } }) {
  const [values, setValues] = useState({ ...defaults, topic: (defaults.orderNumber ? 'order' : '') as SupportTopic | '', message: '', website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const payload = {
      ...values,
      email: values.email || undefined,
      phone: values.phone || undefined,
      orderNumber: values.orderNumber || undefined,
      topic: values.topic || undefined,
    };
    const parsed = supportRequestSchema.safeParse(payload);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    setLoading(true);
    // Send the raw values; the server applies the same schema (and its transforms) itself.
    const result = await api<{ ticketNumber: string }>('/api/v1/support', { body: payload });
    setLoading(false);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      else setFormError(result.error.message);
      return;
    }
    setSent(result.data.ticketNumber);
  };

  if (sent) {
    return (
      <Alert tone="success" title="Message received" className="animate-fade-up">
        Thank you — your reference is <span className="font-medium">{sent}</span>. We will reply to the email or phone number you gave us.
      </Alert>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5" noValidate aria-label="Contact form">
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" required error={errors.name}>
          {(p) => <Input {...p} autoComplete="name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />}
        </Field>
        <Field label="Topic" required error={errors.topic}>
          {(p) => (
            <Select {...p} value={values.topic} onChange={(e) => setValues({ ...values, topic: e.target.value as SupportTopic })}>
              <option value="">Choose a topic</option>
              {SUPPORT_TOPICS.map((t) => (
                <option key={t} value={t}>
                  {SUPPORT_TOPIC_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Email" error={errors.email} hint="We reply by email or phone — give us at least one.">
          {(p) => <Input {...p} type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />}
        </Field>
        <Field label="Mobile number" error={errors.phone}>
          {(p) => (
            <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />
          )}
        </Field>
        <Field label="Order number" error={errors.orderNumber} className="sm:col-span-2" hint="Optional — e.g. MKJ-250101-ABCDE">
          {(p) => <Input {...p} value={values.orderNumber} onChange={(e) => setValues({ ...values, orderNumber: e.target.value })} />}
        </Field>
      </div>
      <Field label="Message" required error={errors.message}>
        {(p) => <Textarea {...p} rows={6} maxLength={4000} value={values.message} onChange={(e) => setValues({ ...values, message: e.target.value })} />}
      </Field>
      {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => setValues({ ...values, website: e.target.value })} />
        </label>
      </div>
      <Button type="submit" size="lg" loading={loading}>
        Send message
      </Button>
    </form>
  );
}
