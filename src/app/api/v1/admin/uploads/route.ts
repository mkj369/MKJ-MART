import { route } from '@/server/http/api';
import { AppError } from '@/server/errors';
import { MAX_UPLOAD_BYTES, saveProductImage } from '@/server/storage';

/** Multipart image upload (field "file"). Images are verified and re-encoded to WebP server-side. */
export const POST = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  const length = Number(ctx.req.headers.get('content-length') ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError(413, 'FILE_TOO_LARGE', 'Images must be 8 MB or smaller.');
  const form = await ctx.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new AppError(400, 'NO_FILE', 'Choose an image to upload.');
  return saveProductImage(file);
});
