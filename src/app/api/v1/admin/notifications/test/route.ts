import { route } from '@/server/http/api';
import { validationError } from '@/server/errors';
import { enforceRateLimit } from '@/server/rate-limit';
import { sendTestMessage } from '@/server/notifications';
import { normalizeBdPhone } from '@/lib/phone';
import { emailSchema } from '@/lib/validation/common';
import { testNotificationSchema } from '@/lib/validation/admin';

/** Sends a real test email/SMS through the configured provider and reports what actually happened. */
export const POST = route(async (ctx) => {
  const user = ctx.requirePermission('settings:manage');
  await enforceRateLimit(`notify-test:${user.id}`, 10, 60 * 60);
  const input = await ctx.body(testNotificationSchema);
  let to = input.to;
  if (input.channel === 'email') {
    const parsed = emailSchema.safeParse(input.to);
    if (!parsed.success) throw validationError({ to: 'Enter a valid email address.' });
    to = parsed.data;
  } else {
    const phone = normalizeBdPhone(input.to);
    if (!phone) throw validationError({ to: 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).' });
    to = phone;
  }
  return sendTestMessage(input.channel, to, user.name);
});
