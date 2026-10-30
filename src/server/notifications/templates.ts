/**
 * Notification templates (email + SMS). Pure functions: data in, message out — unit tested.
 * Every value that can contain customer input is HTML-escaped. SMS bodies stay ASCII ("Tk", not
 * "৳") so they fit in single GSM-7 segments and cost less.
 */
import { formatBDT } from '@/lib/money';
import { ORDER_STATUS_DESCRIPTION, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, type OrderStatus, type PaymentMethod } from '@/lib/order-status';
import { REFUND_METHOD_LABEL, RETURN_STATUS_DESCRIPTION, RETURN_STATUS_LABEL, type RefundMethod, type ReturnStatus } from '@/lib/returns';

export type TemplateData = {
  welcome: { name: string };
  order_confirmation: {
    name: string;
    orderNumber: string;
    items: { name: string; variant: string | null; quantity: number; lineTotal: number }[];
    subtotal: number;
    discount: number;
    shipping: number;
    total: number;
    paymentMethod: PaymentMethod;
    paid: boolean;
    address: string;
    zone: string;
    orderUrl?: string | null;
  };
  order_status: {
    name: string;
    orderNumber: string;
    status: OrderStatus;
    courierName: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    orderUrl?: string | null;
  };
  order_cancelled: { name: string; orderNumber: string; reason: string; wasPaid: boolean; orderUrl?: string | null };
  password_reset: { name: string; resetUrl: string; ttlMinutes: number };
  password_changed: { name: string };
  return_update: {
    name: string;
    requestNumber: string;
    orderNumber: string;
    status: ReturnStatus;
    note: string | null;
    instructions: string | null;
    orderUrl?: string | null;
  };
  refund_recorded: { name: string; orderNumber: string; amount: number; method: RefundMethod; reference: string | null };
  support_received: { name: string; ticketNumber: string; responseTime: string; message: string };
  staff_new_order: { orderNumber: string; orderId: string; customerName: string; total: number; paymentMethod: PaymentMethod; itemCount: number };
  staff_new_return: { requestNumber: string; returnId: string; orderNumber: string; reason: string };
  staff_new_support: { ticketNumber: string; ticketId: string; name: string; topic: string; excerpt: string };
  test_message: { requestedBy: string };
  sms_order_confirmation: { orderNumber: string; total: number; paid: boolean };
  sms_order_status: { orderNumber: string; status: OrderStatus; courierName: string | null; trackingNumber: string | null };
  sms_order_cancelled: { orderNumber: string };
  sms_test_message: { requestedBy: string };
};
export type TemplateName = keyof TemplateData;
export type SmsTemplateName = Extract<TemplateName, `sms_${string}`>;
export type EmailTemplateName = Exclude<TemplateName, SmsTemplateName>;

/** Values that must never be persisted in plain text after delivery (e.g. guest order links). */
export type SecretData = { orderUrl?: string };

export type TemplateContext = {
  appUrl: string;
  store: {
    storeName: string;
    supportEmail: string;
    supportPhone: string;
    address: string;
    legalName: string;
  };
};

export type RenderedEmail = { subject: string; text: string; html: string };

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const esc = escapeHtml;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

function button(href: string, label: string) {
  return `<p style="margin:26px 0 8px"><a href="${esc(href)}" style="display:inline-block;background:#0e0e0e;color:#ffffff;padding:13px 24px;text-decoration:none;font-size:12px;letter-spacing:0.14em;text-transform:uppercase">${esc(label)}</a></p>`;
}

function paragraph(text: string) {
  return `<p style="margin:0 0 14px">${esc(text)}</p>`;
}

function footerLines(ctx: TemplateContext): string[] {
  const s = ctx.store;
  return [
    [s.legalName || s.storeName, s.address].filter(Boolean).join(' · '),
    [s.supportEmail, s.supportPhone].filter(Boolean).join(' · '),
  ].filter(Boolean);
}

function layout(ctx: TemplateContext, title: string, bodyHtml: string): string {
  const footer = footerLines(ctx)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f7f5f0;color:#0e0e0e;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f0;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e7e3db;border-top:3px solid #a88454">
<tr><td style="padding:26px 32px 22px;border-bottom:1px solid #e7e3db;font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:0.12em;text-transform:uppercase">${esc(ctx.store.storeName)}</td></tr>
<tr><td style="padding:30px 32px 26px;font-size:15px;line-height:1.65">${bodyHtml}</td></tr>
<tr><td style="padding:18px 32px 22px;border-top:1px solid #e7e3db;font-size:12px;line-height:1.6;color:#6b665e">${footer}<div style="margin-top:6px">This is a service message about your account or order at ${esc(ctx.store.storeName)}.</div></td></tr>
</table></td></tr></table></body></html>`;
}

function textFooter(ctx: TemplateContext) {
  return ['', '—', ...footerLines(ctx)].join('\n');
}

function itemsTable(items: TemplateData['order_confirmation']['items']) {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #eae6de">${esc(i.name)}${i.variant ? `<div style="font-size:12.5px;color:#6b665e">${esc(i.variant)}</div>` : ''}</td><td style="padding:10px 0;border-bottom:1px solid #eae6de;text-align:center;color:#6b665e">×${i.quantity}</td><td style="padding:10px 0;border-bottom:1px solid #eae6de;text-align:right;white-space:nowrap">${esc(formatBDT(i.lineTotal))}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:18px 0">${rows}</table>`;
}

function totalsTable(d: TemplateData['order_confirmation']) {
  const line = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:4px 0;${strong ? 'font-weight:bold;' : 'color:#6b665e;'}">${esc(label)}</td><td style="padding:4px 0;text-align:right;${strong ? 'font-weight:bold;' : ''}">${esc(value)}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${line('Subtotal', formatBDT(d.subtotal))}${d.discount ? line('Discount', `−${formatBDT(d.discount)}`) : ''}${line('Delivery', d.shipping ? formatBDT(d.shipping) : 'Free')}${line('Total', formatBDT(d.total), true)}</table>`;
}

type EmailRenderer<K extends EmailTemplateName> = (d: TemplateData[K], ctx: TemplateContext, secret: SecretData) => RenderedEmail;

const email: { [K in EmailTemplateName]: EmailRenderer<K> } = {
  welcome: (d, ctx) => {
    const subject = `Welcome to ${ctx.store.storeName}`;
    const shop = `${ctx.appUrl}/shop`;
    return {
      subject,
      text: [`Hi ${firstName(d.name)},`, '', `Your ${ctx.store.storeName} account is ready. You can track orders, save addresses and keep a wishlist.`, '', `Start shopping: ${shop}`, textFooter(ctx)].join('\n'),
      html: layout(ctx, subject, `${paragraph(`Hi ${firstName(d.name)},`)}${paragraph(`Your ${ctx.store.storeName} account is ready. You can track orders, save delivery addresses and keep a wishlist.`)}${button(shop, 'Start shopping')}`),
    };
  },

  order_confirmation: (d, ctx, secret) => {
    const url = secret.orderUrl ?? d.orderUrl ?? `${ctx.appUrl}/track-order?order=${encodeURIComponent(d.orderNumber)}`;
    const subject = d.paid ? `Payment received — order ${d.orderNumber}` : `Order ${d.orderNumber} received`;
    const lead = d.paid
      ? 'We have received your payment and your order is confirmed. We will let you know when it ships.'
      : d.paymentMethod === 'cod'
        ? 'Thank you for your order. We will confirm it shortly — please keep your phone reachable. You pay in cash when it arrives.'
        : 'Thank you for your order.';
    const textItems = d.items.map((i) => `- ${i.name}${i.variant ? ` (${i.variant})` : ''} ×${i.quantity}: ${formatBDT(i.lineTotal)}`);
    return {
      subject,
      text: [
        `Hi ${firstName(d.name)},`,
        '',
        lead,
        '',
        `Order ${d.orderNumber}`,
        ...textItems,
        `Subtotal: ${formatBDT(d.subtotal)}`,
        ...(d.discount ? [`Discount: -${formatBDT(d.discount)}`] : []),
        `Delivery: ${d.shipping ? formatBDT(d.shipping) : 'Free'}`,
        `Total: ${formatBDT(d.total)}`,
        `Payment: ${PAYMENT_METHOD_LABEL[d.paymentMethod]}${d.paid ? ' (paid)' : ''}`,
        `Deliver to: ${d.address} (${d.zone})`,
        '',
        `View your order: ${url}`,
        textFooter(ctx),
      ].join('\n'),
      html: layout(
        ctx,
        subject,
        `${paragraph(`Hi ${firstName(d.name)},`)}${paragraph(lead)}<div style="margin-top:18px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#84653a">Order ${esc(d.orderNumber)}</div>${itemsTable(d.items)}${totalsTable(d)}<p style="margin:18px 0 0;font-size:13.5px;color:#6b665e">Payment: ${esc(PAYMENT_METHOD_LABEL[d.paymentMethod])}${d.paid ? ' · paid' : ''}<br>Deliver to: ${esc(d.address)} (${esc(d.zone)})</p>${button(url, 'View your order')}`,
      ),
    };
  },

  order_status: (d, ctx, secret) => {
    const url = secret.orderUrl ?? d.orderUrl ?? `${ctx.appUrl}/track-order?order=${encodeURIComponent(d.orderNumber)}`;
    const label = ORDER_STATUS_LABEL[d.status];
    const subject = `Order ${d.orderNumber}: ${label}`;
    const shipping =
      d.status === 'shipped' && d.courierName
        ? `Courier: ${d.courierName}${d.trackingNumber ? ` · Tracking number: ${d.trackingNumber}` : ''}`
        : null;
    return {
      subject,
      text: [`Hi ${firstName(d.name)},`, '', `${ORDER_STATUS_DESCRIPTION[d.status]}`, ...(shipping ? ['', shipping] : []), ...(d.trackingUrl ? [`Track the parcel: ${d.trackingUrl}`] : []), '', `Order details: ${url}`, textFooter(ctx)].join('\n'),
      html: layout(
        ctx,
        subject,
        `${paragraph(`Hi ${firstName(d.name)},`)}<div style="margin:6px 0 12px;font-family:Georgia,serif;font-size:20px">${esc(label)}</div>${paragraph(ORDER_STATUS_DESCRIPTION[d.status])}${shipping ? `<p style="margin:0 0 14px;font-size:14px;color:#6b665e">${esc(shipping)}</p>` : ''}${d.trackingUrl ? button(d.trackingUrl, 'Track the parcel') : ''}${button(url, 'Order details')}`,
      ),
    };
  },

  order_cancelled: (d, ctx, secret) => {
    const url = secret.orderUrl ?? d.orderUrl ?? `${ctx.appUrl}/track-order?order=${encodeURIComponent(d.orderNumber)}`;
    const subject = `Order ${d.orderNumber} cancelled`;
    const refund = d.wasPaid ? 'You paid for this order online — our team will contact you about your refund.' : 'You have not been charged.';
    return {
      subject,
      text: [`Hi ${firstName(d.name)},`, '', `Your order ${d.orderNumber} has been cancelled. ${d.reason}`, refund, '', `Order details: ${url}`, textFooter(ctx)].join('\n'),
      html: layout(ctx, subject, `${paragraph(`Hi ${firstName(d.name)},`)}${paragraph(`Your order ${d.orderNumber} has been cancelled. ${d.reason}`)}${paragraph(refund)}${button(url, 'Order details')}`),
    };
  },

  password_reset: (d, ctx) => {
    const subject = `Reset your ${ctx.store.storeName} password`;
    const lines = [`Someone (hopefully you) asked to reset the password for your ${ctx.store.storeName} account.`, `This link works once and expires in ${d.ttlMinutes} minutes.`];
    const ignore = 'If you did not ask for this, you can ignore this email — your password will not change.';
    return {
      subject,
      text: [`Hi ${firstName(d.name)},`, '', ...lines, '', d.resetUrl, '', ignore, textFooter(ctx)].join('\n'),
      html: layout(ctx, subject, `${paragraph(`Hi ${firstName(d.name)},`)}${lines.map(paragraph).join('')}${button(d.resetUrl, 'Choose a new password')}<p style="margin:16px 0 0;font-size:13px;color:#6b665e">${esc(ignore)}</p>`),
    };
  },

  password_changed: (d, ctx) => {
    const subject = `Your ${ctx.store.storeName} password was changed`;
    const body = 'The password for your account was just changed and all other devices were signed out.';
    const help = `If this was not you, reset your password immediately at ${ctx.appUrl}/forgot-password and contact us.`;
    return {
      subject,
      text: [`Hi ${firstName(d.name)},`, '', body, help, textFooter(ctx)].join('\n'),
      html: layout(ctx, subject, `${paragraph(`Hi ${firstName(d.name)},`)}${paragraph(body)}${paragraph(help)}`),
    };
  },

  return_update: (d, ctx, secret) => {
    const url = secret.orderUrl ?? d.orderUrl ?? `${ctx.appUrl}/track-order?order=${encodeURIComponent(d.orderNumber)}`;
    const subject = `Return ${d.requestNumber}: ${RETURN_STATUS_LABEL[d.status]}`;
    const parts = [RETURN_STATUS_DESCRIPTION[d.status], d.note, d.status === 'approved' ? d.instructions : null].filter((x): x is string => !!x);
    return {
      subject,
      text: [`Hi ${firstName(d.name)},`, '', `Return ${d.requestNumber} for order ${d.orderNumber}:`, ...parts, '', `Order details: ${url}`, textFooter(ctx)].join('\n'),
      html: layout(ctx, subject, `${paragraph(`Hi ${firstName(d.name)},`)}<div style="margin:6px 0 12px;font-family:Georgia,serif;font-size:20px">${esc(RETURN_STATUS_LABEL[d.status])}</div><p style="margin:0 0 14px;font-size:13px;color:#6b665e">Return ${esc(d.requestNumber)} · Order ${esc(d.orderNumber)}</p>${parts.map(paragraph).join('')}${button(url, 'Order details')}`),
    };
  },

  refund_recorded: (d, ctx) => {
    const subject = `Refund issued for order ${d.orderNumber}`;
    const body = `We have refunded ${formatBDT(d.amount)} via ${REFUND_METHOD_LABEL[d.method]}${d.reference ? ` (reference ${d.reference})` : ''}.`;
    const timing = 'Depending on your bank or mobile wallet, it can take a few working days to appear.';
    return {
      subject,
      text: [`Hi ${firstName(d.name)},`, '', body, timing, textFooter(ctx)].join('\n'),
      html: layout(ctx, subject, `${paragraph(`Hi ${firstName(d.name)},`)}${paragraph(body)}${paragraph(timing)}`),
    };
  },

  support_received: (d, ctx) => {
    const subject = `We received your message (${d.ticketNumber})`;
    const body = `Thanks for contacting ${ctx.store.storeName}. Your reference is ${d.ticketNumber}. We aim to reply ${d.responseTime || 'as soon as possible'}.`;
    return {
      subject,
      text: [`Hi ${firstName(d.name)},`, '', body, '', 'Your message:', d.message, textFooter(ctx)].join('\n'),
      html: layout(ctx, subject, `${paragraph(`Hi ${firstName(d.name)},`)}${paragraph(body)}<blockquote style="margin:16px 0 0;padding:12px 16px;border-left:3px solid #d8c39f;background:#f7f5f0;font-size:14px;white-space:pre-wrap">${esc(d.message)}</blockquote>`),
    };
  },

  staff_new_order: (d, ctx) => {
    const url = `${ctx.appUrl}/admin/orders/${d.orderId}`;
    const subject = `New order ${d.orderNumber} — ${formatBDT(d.total)}`;
    const body = `${d.customerName} placed order ${d.orderNumber}: ${d.itemCount} item(s), ${formatBDT(d.total)}, ${PAYMENT_METHOD_LABEL[d.paymentMethod]}.`;
    return { subject, text: [body, '', url].join('\n'), html: layout(ctx, subject, `${paragraph(body)}${button(url, 'Open in admin')}`) };
  },

  staff_new_return: (d, ctx) => {
    const url = `${ctx.appUrl}/admin/returns/${d.returnId}`;
    const subject = `Return request ${d.requestNumber} (order ${d.orderNumber})`;
    const body = `A customer requested a return for order ${d.orderNumber}. Reason: ${d.reason}.`;
    return { subject, text: [body, '', url].join('\n'), html: layout(ctx, subject, `${paragraph(body)}${button(url, 'Review the request')}`) };
  },

  staff_new_support: (d, ctx) => {
    const url = `${ctx.appUrl}/admin/support/${d.ticketId}`;
    const subject = `Support message ${d.ticketNumber}: ${d.topic}`;
    return {
      subject,
      text: [`From: ${d.name}`, `Topic: ${d.topic}`, '', d.excerpt, '', url].join('\n'),
      html: layout(ctx, subject, `${paragraph(`From: ${d.name} · Topic: ${d.topic}`)}<blockquote style="margin:0;padding:12px 16px;border-left:3px solid #d8c39f;background:#f7f5f0;font-size:14px;white-space:pre-wrap">${esc(d.excerpt)}</blockquote>${button(url, 'Open in admin')}`),
    };
  },

  test_message: (d, ctx) => {
    const subject = `${ctx.store.storeName}: test email`;
    const body = `This is a test email requested by ${d.requestedBy} from the admin panel. If you can read it, outgoing email is working.`;
    return { subject, text: body, html: layout(ctx, subject, paragraph(body)) };
  },
};

const smsText: { [K in SmsTemplateName]: (d: TemplateData[K], ctx: TemplateContext) => string } = {
  sms_order_confirmation: (d, ctx) =>
    d.paid
      ? `${ctx.store.storeName}: payment received for order ${d.orderNumber} (Tk ${Math.round(d.total / 100)}). We will notify you when it ships.`
      : `${ctx.store.storeName}: order ${d.orderNumber} received (Tk ${Math.round(d.total / 100)}). We will call to confirm it shortly.`,
  sms_order_status: (d, ctx) => {
    if (d.status === 'shipped') {
      return `${ctx.store.storeName}: order ${d.orderNumber} has shipped${d.courierName ? ` with ${d.courierName}` : ''}${d.trackingNumber ? `, tracking ${d.trackingNumber}` : ''}.`;
    }
    if (d.status === 'delivered') return `${ctx.store.storeName}: order ${d.orderNumber} was delivered. Thank you for shopping with us.`;
    return `${ctx.store.storeName}: order ${d.orderNumber} is now ${ORDER_STATUS_LABEL[d.status].toLowerCase()}.`;
  },
  sms_order_cancelled: (d, ctx) => `${ctx.store.storeName}: order ${d.orderNumber} has been cancelled.`,
  sms_test_message: (d, ctx) => `${ctx.store.storeName}: test SMS requested by ${d.requestedBy}. Outgoing SMS is working.`,
};

export function isSmsTemplate(name: TemplateName): name is SmsTemplateName {
  return name.startsWith('sms_');
}

export function renderEmail<K extends EmailTemplateName>(name: K, data: TemplateData[K], ctx: TemplateContext, secret: SecretData = {}): RenderedEmail {
  return (email[name] as EmailRenderer<K>)(data, ctx, secret);
}

export function renderSms<K extends SmsTemplateName>(name: K, data: TemplateData[K], ctx: TemplateContext): string {
  return (smsText[name] as (d: TemplateData[K], c: TemplateContext) => string)(data, ctx).slice(0, 480);
}
