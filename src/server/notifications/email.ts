import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { smtpConfig, type SmtpConfig } from '@/server/env';

/**
 * SMTP delivery via nodemailer. Works with any SMTP relay (Amazon SES, Mailgun, Brevo, Postmark,
 * Zoho, Google Workspace…). Unless SMTP_SECURE=true (implicit TLS, port 465), STARTTLS is required
 * so credentials and customer data are never sent in clear text; SMTP_REQUIRE_TLS=false exists only
 * for local test servers.
 */
let cached: { key: string; transporter: Transporter } | null = null;

function transporterFor(config: SmtpConfig): Transporter {
  const key = JSON.stringify([config.host, config.port, config.secure, config.requireTls, config.user, config.password]);
  if (cached?.key === key) return cached.transporter;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    ignoreTLS: !config.secure && !config.requireTls,
    auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  cached = { key, transporter };
  return transporter;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email is not configured (set SMTP_HOST and SMTP_FROM).');
    this.name = 'EmailNotConfiguredError';
  }
}

export async function sendEmail(message: { to: string; subject: string; text: string; html: string }): Promise<{ messageId: string }> {
  const config = smtpConfig();
  if (!config) throw new EmailNotConfiguredError();
  const info = await transporterFor(config).sendMail({
    from: config.from,
    replyTo: config.replyTo ?? undefined,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  // nodemailer resolves only after the server accepted the message (250 OK); rejected recipients throw.
  const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;
  if (rejected > 0) throw new Error(`SMTP server rejected the recipient (${String(info.response ?? '').slice(0, 200)})`);
  return { messageId: String(info.messageId ?? '') };
}
