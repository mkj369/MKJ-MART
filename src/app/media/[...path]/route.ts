import { log } from '@/server/logger';
import { readMedia } from '@/server/storage';

/** Serves admin-uploaded images (immutable: filenames are random UUIDs). */
export async function GET(_req: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  let file;
  try {
    file = await readMedia(path);
  } catch (error) {
    log.error('media.read_failed', { error });
    return new Response('Storage unavailable', { status: 503, headers: { 'retry-after': '30' } });
  }
  if (!file) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });
  return new Response(new Uint8Array(file.data), {
    headers: {
      'content-type': file.contentType,
      'content-length': String(file.data.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
