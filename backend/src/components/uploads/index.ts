import { Readable } from 'node:stream';
import busboy from 'busboy';
import { Elysia } from 'elysia';

import { errors } from '#utils/errors.js';
import {
  ALLOWED_MIME_TO_EXT,
  createUploadReadStream,
  mimeForUploadFilename,
  streamUploadToDisk,
  UPLOAD_FILENAME_RE,
} from '#utils/uploads.js';

const MAX_UPLOAD_BYTES = 6_000_000;

// Parses multipart directly via busboy rather than Elysia's built-in validation, which buffers each file fully in memory via Request.formData() before a handler sees it. Elysia still auto-parses (and locks) the body by default even with no `body` schema declared, so `parse: 'none'` below is required for request.body to reach us unread.
export const uploads = new Elysia({ prefix: '/uploads' })
  .post(
    '/',
    async ({ request }) => {
      if (!request.body) throw errors.uploads.missingFile();

      const bb = busboy({
        headers: Object.fromEntries(request.headers),
        limits: { files: 1, fileSize: MAX_UPLOAD_BYTES },
      });

      const ref = await new Promise<string>((resolve, reject) => {
        let sawFile = false;

        bb.on('file', (_name, fileStream, info) => {
          sawFile = true;
          const ext = ALLOWED_MIME_TO_EXT[info.mimeType];
          if (!ext) {
            fileStream.resume(); // drain so 'close' still fires
            reject(errors.uploads.unsupportedType(info.mimeType));
            return;
          }

          fileStream.on('limit', () => reject(errors.uploads.tooLarge()));
          streamUploadToDisk(fileStream, info.mimeType).then(resolve, reject);
        });

        bb.on('error', reject);
        bb.on('close', () => {
          if (!sawFile) reject(errors.uploads.missingFile());
        });

        Readable.fromWeb(
          request.body as import('node:stream/web').ReadableStream,
        ).pipe(bb);
      });

      return { ref };
    },
    { parse: 'none' },
  )
  .get('/:filename', ({ params, set }) => {
    if (!UPLOAD_FILENAME_RE.test(params.filename)) {
      throw errors.uploads.invalidRef();
    }
    set.headers['content-type'] = mimeForUploadFilename(params.filename);
    return createUploadReadStream(params.filename);
  });
