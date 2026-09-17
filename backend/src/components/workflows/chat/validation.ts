import { t } from 'elysia';

import { ModelName } from '#types.js';

import { UPLOAD_FILENAME_PATTERN } from '#utils/uploads.js';

const MAX_MESSAGE_LENGTH = 20_000;
const MAX_IMAGES = 6;
// Client uploads each image via POST /api/uploads first and sends back only the ref.
const UPLOAD_REF_PATTERN = `^/api/uploads/${UPLOAD_FILENAME_PATTERN}$`;

export const sendChatMessageSchema = t.Object({
  message: t.String({ minLength: 1, maxLength: MAX_MESSAGE_LENGTH }),
  images: t.Optional(
    t.Array(t.String({ pattern: UPLOAD_REF_PATTERN }), {
      maxItems: MAX_IMAGES,
    }),
  ),
  model: t.Enum(ModelName),
  reasoning: t.Optional(t.Boolean()),
  tools: t.Object({
    server: t.Boolean(),
    gitlab: t.Boolean(),
    webSearch: t.Boolean(),
  }),
});
