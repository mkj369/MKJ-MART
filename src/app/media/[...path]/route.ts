import { readMedia } from '@/server/storage';

/** Serves admin-uploaded images from UPLOAD_DIR (immutable, content-addressed by UUID filenames). */
export async function GET(_req: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const file = await readMedia(path);
  if (!file) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      'content-type': file.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
