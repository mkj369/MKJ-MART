import { z } from 'zod';
import { route } from '@/server/http/api';
import { notFound } from '@/server/errors';
import { getSetting, updateSetting } from '@/server/services/settings';
import { SETTINGS_SCHEMAS, type SettingsKey } from '@/lib/validation/admin';

function settingsKey(value: string): SettingsKey {
  if (!(value in SETTINGS_SCHEMAS)) throw notFound('Unknown settings group.');
  return value as SettingsKey;
}

export const GET = route<{ key: string }>(async (ctx) => {
  ctx.requirePermission('settings:manage');
  return getSetting(settingsKey(ctx.params.key));
});

export const PUT = route<{ key: string }>(async (ctx) => {
  ctx.requirePermission('settings:manage');
  const key = settingsKey(ctx.params.key);
  return updateSetting(key, await ctx.body(z.unknown()));
});
