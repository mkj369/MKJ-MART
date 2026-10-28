import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { AppError } from '@/server/errors';
import { uploadDir } from '@/server/env';

/**
 * Local-disk media storage for admin uploads, served by /media/[...path].
 * Every upload is decoded and RE-ENCODED to WebP by sharp, which (a) verifies it really is an image
 * (content sniffing, not the client-supplied MIME type), (b) strips EXIF/GPS metadata and
 * (c) normalises size. In multi-instance production, mount UPLOAD_DIR on shared storage or swap this
 * module for an S3-compatible implementation with the same interface.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff']);
const MAX_DIMENSION = 1800;

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

  const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
    .rotate() // apply EXIF orientation before metadata is stripped
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const now = new Date();
  const relDir = path.posix.join('products', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  const fileName = `${randomUUID()}.webp`;
  const absDir = path.resolve(uploadDir(), relDir);
  await mkdir(absDir, { recursive: true });
  await writeFile(path.join(absDir, fileName), data);
  return { url: `/media/${relDir}/${fileName}`, width: info.width, height: info.height };
}

const SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/;
const CONTENT_TYPES: Record<string, string> = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif' };

/** Reads a stored media file, refusing anything outside UPLOAD_DIR (path traversal safe). */
export async function readMedia(segments: string[]): Promise<{ data: Buffer; contentType: string } | null> {
  if (segments.length === 0 || segments.length > 6 || !segments.every((s) => SEGMENT.test(s))) return null;
  const root = path.resolve(uploadDir());
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(root + path.sep)) return null;
  const contentType = CONTENT_TYPES[path.extname(target).toLowerCase()];
  if (!contentType) return null;
  try {
    return { data: await readFile(target), contentType };
  } catch {
    return null;
  }
}
