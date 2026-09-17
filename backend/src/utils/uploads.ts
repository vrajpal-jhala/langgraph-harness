import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { config } from './config.js';

const UPLOADS_DIR = join(config.dataPath, 'uploads');

// Generic, not chat-specific — every file upload in the app goes through this store.
export const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const EXT_TO_MIME = Object.fromEntries(
  Object.entries(ALLOWED_MIME_TO_EXT).map(([mime, ext]) => [ext, mime]),
);

// export reusable pattern
export const UPLOAD_FILENAME_PATTERN = '[a-f0-9]{64}\\.(png|jpg|webp|gif)';
// Matches exactly what streamUploadToDisk produces — anything else reaching the serving/loading routes is untrusted input.
export const UPLOAD_FILENAME_RE = new RegExp(`^${UPLOAD_FILENAME_PATTERN}$`);

export function uploadRefToFilename(ref: string): string {
  return ref.replace(/^\/api\/uploads\//, '');
}

export function uploadFilePath(filename: string): string {
  return join(UPLOADS_DIR, filename);
}

export function mimeForUploadFilename(filename: string): string {
  const ext = filename.split('.').pop() as string;
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

// Hashes while streaming to disk (bounded memory), writes to a temp name and renames into place (no partial file on a mid-stream failure or concurrent same-content upload), and the content-hash filename gives free dedup.
export async function streamUploadToDisk(
  stream: NodeJS.ReadableStream,
  mime: string,
): Promise<string> {
  const ext = ALLOWED_MIME_TO_EXT[mime];
  if (!ext) throw new Error(`Unsupported file type: ${mime}`);

  await mkdir(UPLOADS_DIR, { recursive: true });
  const tmpPath = join(UPLOADS_DIR, `.tmp-${crypto.randomUUID()}`);
  const hash = createHash('sha256');

  try {
    await pipeline(
      stream,
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(tmpPath),
    );
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }

  const filename = `${hash.digest('hex')}.${ext}`;
  const finalPath = join(UPLOADS_DIR, filename);
  try {
    await rename(tmpPath, finalPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    // Another upload of the same content already landed here — fine.
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  return `/api/uploads/${filename}`;
}

// Reconstructs a data URL for callers (e.g. a vision-capable LLM) that need the actual bytes rather than a servable path.
export async function loadUploadAsDataUrl(ref: string): Promise<string> {
  const filename = uploadRefToFilename(ref);
  if (!UPLOAD_FILENAME_RE.test(filename)) {
    throw new Error(`Invalid upload ref: ${ref}`);
  }
  const bytes = await readFile(uploadFilePath(filename));
  return `data:${mimeForUploadFilename(filename)};base64,${bytes.toString('base64')}`;
}

export function createUploadReadStream(filename: string) {
  return createReadStream(uploadFilePath(filename));
}

// Used by the GC sweep to find uploads nothing references anymore (a failed send, or a deleted thread's only referencing file).
export async function listUploadFilenames(): Promise<string[]> {
  try {
    return await readdir(UPLOADS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function deleteUpload(filename: string): Promise<void> {
  await rm(uploadFilePath(filename), { force: true });
}
