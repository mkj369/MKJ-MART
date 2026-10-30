import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import sharp, { type Metadata } from 'sharp';
import { AppError } from '@/server/errors';
import { storageConfig, type StorageConfig } from '@/server/env';

/**
 * Media storage for admin uploads, always served by /media/[...path] so URLs do not change when
 * the backend changes:
 *  - local (default): files under UPLOAD_DIR, written atomically (temp file + rename) — mount it on a
 *    persistent volume and include it in backups;
 *  - s3: any S3-compatible bucket (private is fine), via SigV4-signed requests.
 * Every upload is decoded and RE-ENCODED to WebP by sharp, which (a) verifies it really is an image
 * (content sniffing, not the client-supplied MIME type), (b) strips EXIF/GPS metadata and
 * (c) normalises size. Filenames are random UUIDs, so stored objects are immutable.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff']);
const MAX_DIMENSION = 1800;
const MIN_DIMENSION = 300;

type StoredObject = { data: Buffer; contentType: string };

interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  /** Cheap liveness check for the launch checklist. */
  check(): Promise<{ ok: boolean; detail: string }>;
}

const CONTENT_TYPES: Record<string, string> = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif' };

function localDriver(config: Extract<StorageConfig, { driver: 'local' }>): StorageDriver {
  const root = path.resolve(config.dir);
  const resolve = (key: string) => {
    const target = path.resolve(root, ...key.split('/'));
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid media key');
    return target;
  };
  return {
    async put(key, data) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, data, { flag: 'wx' });
        await rename(temp, target); // atomic on the same filesystem: readers never see half a file
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
    async get(key) {
      const contentType = CONTENT_TYPES[path.extname(key).toLowerCase()];
      if (!contentType) return null;
      try {
        return { data: await readFile(resolve(key)), contentType };
      } catch {
        return null;
      }
    },
    async check() {
      try {
        await mkdir(root, { recursive: true });
        const probe = path.join(root, `.write-check-${randomUUID()}`);
        await writeFile(probe, 'ok');
        await rm(probe, { force: true });
        return { ok: true, detail: `Local disk: ${root} (must be a persistent, backed-up volume).` };
      } catch (error) {
        return { ok: false, detail: `UPLOAD_DIR ${root} is not writable: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}

function s3Driver(config: Extract<StorageConfig, { driver: 's3' }>): StorageDriver {
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: config.region });
  const objectUrl = (key: string) => {
    const encoded = `${config.prefix}${key}`.split('/').map(encodeURIComponent).join('/');
    if (config.forcePathStyle) return `${config.endpoint}/${config.bucket}/${encoded}`;
    const url = new URL(config.endpoint);
    return `${url.protocol}//${config.bucket}.${url.host}/${encoded}`;
  };
  const bucketUrl = () => {
    if (config.forcePathStyle) return `${config.endpoint}/${config.bucket}`;
    const url = new URL(config.endpoint);
    return `${url.protocol}//${config.bucket}.${url.host}/`;
  };
  return {
    async put(key, data, contentType) {
      const response = await client.fetch(objectUrl(key), {
        method: 'PUT',
        body: new Uint8Array(data),
        headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Object storage rejected the upload (HTTP ${response.status}).`);
    },
    async get(key) {
      const response = await client.fetch(objectUrl(key), { method: 'GET', signal: AbortSignal.timeout(15_000) });
      if (response.status === 404 || response.status === 403) return null;
      if (!response.ok) throw new Error(`Object storage HTTP ${response.status}`);
      const contentType = CONTENT_TYPES[path.extname(key).toLowerCase()] ?? response.headers.get('content-type') ?? 'application/octet-stream';
      return { data: Buffer.from(await response.arrayBuffer()), contentType };
    },
    async check() {
      try {
        const response = await client.fetch(bucketUrl(), { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
        return response.ok
          ? { ok: true, detail: `S3-compatible bucket "${config.bucket}" at ${new URL(config.endpoint).host}.` }
          : { ok: false, detail: `Bucket "${config.bucket}" answered HTTP ${response.status} — check S3_* settings and credentials.` };
      } catch (error) {
        return { ok: false, detail: `Object storage unreachable: ${error instanceof Error ? error.name : 'network error'}` };
      }
    },
  };
}

function driver(): StorageDriver {
  const config = storageConfig();
  return config.driver === 's3' ? s3Driver(config) : localDriver(config);
}

export async function checkStorage(): Promise<{ ok: boolean; detail: string }> {
  try {
    return await driver().check();
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveProductImage(file: File): Promise<{ url: string; width: number; height: number }> {
  if (file.size === 0) throw new AppError(400, 'EMPTY_FILE', 'The file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'Images must be 8 MB or smaller.');
  const input = Buffer.from(await file.arrayBuffer());

  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new AppError(415, 'INVALID_IMAGE', 'This file is not a supported image.');
  }
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new AppError(415, 'INVALID_IMAGE', 'Upload a JPEG, PNG, WebP or AVIF image.');
  }
  if ((metadata.width ?? 0) < MIN_DIMENSION || (metadata.height ?? 0) < MIN_DIMENSION) {
    throw new AppError(422, 'IMAGE_TOO_SMALL', `Images must be at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`);
  }

  const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
    .rotate() // apply EXIF orientation before metadata is stripped
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const now = new Date();
  const key = path.posix.join('products', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), `${randomUUID()}.webp`);
  try {
    await driver().put(key, data, 'image/webp');
  } catch (error) {
    throw new AppError(503, 'STORAGE_UNAVAILABLE', 'The image could not be stored. Please try again.', {
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
  return { url: `/media/${key}`, width: info.width, height: info.height };
}

const SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/;

/** Reads a stored media object, refusing anything that is not a plain media key (path traversal safe). */
export async function readMedia(segments: string[]): Promise<StoredObject | null> {
  if (segments.length === 0 || segments.length > 6 || !segments.every((s) => SEGMENT.test(s))) return null;
  const key = segments.join('/');
  if (!CONTENT_TYPES[path.extname(key).toLowerCase()]) return null;
  return driver().get(key);
}
