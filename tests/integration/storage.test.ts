import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import S3rver from 's3rver';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkStorage, readMedia, saveProductImage } from '@/server/storage';
import { GET as media } from '@/app/media/[...path]/route';

/**
 * Upload validation and both storage drivers.
 * The S3 driver runs against S3_TEST_ENDPOINT when set (CI starts Silo, a maintained MinIO fork
 * that verifies AWS Signature V4 and rejects bad credentials). Otherwise it falls back to s3rver, a local
 * S3-compatible server that exercises the protocol and paths but does NOT verify signatures — so
 * the bad-credentials case only runs against a real verifier.
 */
async function imageFile(width: number, height: number, format: 'png' | 'jpeg' = 'jpeg', name = 'photo.jpg') {
  const buffer = await sharp({ create: { width, height, channels: 3, background: '#a88454' } })
    [format]()
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
    .toBuffer();
  return new File([new Uint8Array(buffer)], name, { type: `image/${format}` });
}

const segments = (url: string) => url.replace(/^\/media\//, '').split('/');

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mkj-uploads-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));
afterEach(() => {
  for (const key of ['STORAGE_DRIVER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION', 'UPLOAD_DIR']) delete process.env[key];
});

describe('upload validation', () => {
  it('re-encodes images to WebP, strips metadata and serves them with safe headers', async () => {
    process.env.UPLOAD_DIR = dir;
    const saved = await saveProductImage(await imageFile(2400, 3200));
    expect(saved.url).toMatch(/^\/media\/products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/);
    expect(saved).toMatchObject({ width: 1350, height: 1800 }); // fits inside 1800px
    const stored = (await readMedia(segments(saved.url)))!;
    const meta = await sharp(stored.data).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    const res = await media(new Request(`http://localhost${saved.url}`), { params: Promise.resolve({ path: segments(saved.url) }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    // No temp files are left behind by the atomic write.
    const month = path.join(dir, ...segments(saved.url).slice(0, -1));
    expect((await readdir(month)).every((f) => f.endsWith('.webp'))).toBe(true);
  });

  it('rejects non-images, disguised files, tiny images and traversal attempts', async () => {
    process.env.UPLOAD_DIR = dir;
    const fake = new File([new TextEncoder().encode('<?php system($_GET["c"]); ?>')], 'shell.jpg', { type: 'image/jpeg' });
    await expect(saveProductImage(fake)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    const svg = new File([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')], 'x.svg', { type: 'image/svg+xml' });
    await expect(saveProductImage(svg)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(saveProductImage(await imageFile(120, 120, 'png', 'tiny.png'))).rejects.toMatchObject({ code: 'IMAGE_TOO_SMALL' });
    await expect(saveProductImage(new File([], 'empty.jpg'))).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    expect(await readMedia(['..', 'etc', 'passwd'])).toBeNull();
    expect(await readMedia(['products', '..%2F..%2Fsecret.webp'])).toBeNull();
    expect(await readMedia(['products', 'file.php'])).toBeNull();
  });
});

const external = process.env.S3_TEST_ENDPOINT
  ? {
      endpoint: process.env.S3_TEST_ENDPOINT,
      bucket: process.env.S3_TEST_BUCKET ?? 'mkj-media',
      accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? 'minioadmin',
      secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'minioadmin',
    }
  : null;

describe('S3-compatible storage driver', () => {
  let server: S3rver | null = null;
  let s3Dir: string | null = null;
  let target: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };

  beforeAll(async () => {
    if (external) {
      target = external;
      return;
    }
    s3Dir = await mkdtemp(path.join(os.tmpdir(), 'mkj-s3-'));
    server = new S3rver({ port: 0, address: '127.0.0.1', silent: true, directory: s3Dir, configureBuckets: [{ name: 'mkj-media', configs: [] }] });
    const { port } = (await server.run()) as unknown as { port: number };
    target = { endpoint: `http://127.0.0.1:${port}`, bucket: 'mkj-media', accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' };
  });
  afterAll(async () => {
    await server?.close();
    if (s3Dir) await rm(s3Dir, { recursive: true, force: true });
  });

  const useS3 = (secret?: string) => {
    Object.assign(process.env, {
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: target.endpoint,
      S3_BUCKET: target.bucket,
      S3_ACCESS_KEY_ID: target.accessKeyId,
      S3_SECRET_ACCESS_KEY: secret ?? target.secretAccessKey,
      S3_REGION: 'us-east-1',
    });
  };

  it('stores and serves images through signed requests', async () => {
    useS3();
    expect((await checkStorage()).ok).toBe(true);
    const saved = await saveProductImage(await imageFile(900, 1200));
    expect(saved.url).toMatch(/^\/media\/products\//);
    const stored = (await readMedia(segments(saved.url)))!;
    expect((await sharp(stored.data).metadata()).format).toBe('webp');
    expect(await readMedia(['products', '2026', '01', '00000000-0000-0000-0000-000000000000.webp'])).toBeNull();
  });

  it.skipIf(!external)('fails loudly (not silently) with wrong credentials', async () => {
    useS3('wrong-secret-key');
    expect((await checkStorage()).ok).toBe(false);
    await expect(saveProductImage(await imageFile(600, 800))).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('refuses to start with incomplete S3 settings', async () => {
    process.env.STORAGE_DRIVER = 's3';
    expect((await checkStorage()).ok).toBe(false);
  });
});
