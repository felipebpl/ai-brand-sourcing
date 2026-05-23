import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Local filesystem storage for uploaded quotation files.
 *
 * In production this would be S3/GCS/Supabase Storage with a signed URL.
 * For the trial we keep it dead simple: write to `apps/api/.storage/uploads/`
 * (gitignored) and pass the absolute path to the parser.
 *
 * Storage layout:
 *   apps/api/.storage/uploads/<uuid>__<original-filename>.xlsx
 *
 * The uuid prefix protects against name collisions; we keep the original
 * filename suffix so the parser agent has a hint about the source.
 */

const STORAGE_ROOT = resolve(
  import.meta.dir,
  '..',
  '..',
  '.storage',
  'uploads',
);

export interface SavedFile {
  storageUri: string;
  uploadedFilename: string;
}

export async function saveUpload(args: {
  filename: string;
  bytes: Uint8Array | ArrayBuffer;
}): Promise<SavedFile> {
  await mkdir(STORAGE_ROOT, { recursive: true });
  const safeFilename = sanitizeFilename(args.filename);
  const storageId = randomUUID();
  const path = resolve(STORAGE_ROOT, `${storageId}__${safeFilename}`);
  const bytes =
    args.bytes instanceof Uint8Array
      ? args.bytes
      : new Uint8Array(args.bytes);
  await Bun.write(path, bytes);
  return {
    storageUri: path,
    uploadedFilename: args.filename,
  };
}

function sanitizeFilename(name: string): string {
  // Strip directory parts, keep alphanum + dots + dashes + underscores.
  const base = name.split(/[\\/]/).pop() ?? 'upload.xlsx';
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'upload.xlsx';
}
