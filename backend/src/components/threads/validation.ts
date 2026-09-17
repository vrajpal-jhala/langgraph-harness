import { t } from 'elysia';

import { RunKind } from '#types.js';

const titleSchema = t.String({ minLength: 1, maxLength: 255 });

export const createThreadSchema = t.Object({
  title: titleSchema,
  kind: t.Enum(RunKind),
});

export const updateThreadSchema = t.Object({ title: titleSchema });

export const listThreadsQuerySchema = t.Object({
  kinds: t.Optional(t.Array(t.Enum(RunKind))),
  projects: t.Optional(t.Array(t.String())),
  statuses: t.Optional(t.Array(t.String())),
  title: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Numeric({ minimum: 0 })),
});
