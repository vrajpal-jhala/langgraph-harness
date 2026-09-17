import { t } from 'elysia';

import { MemoryCategory, MemoryScope } from '#types.js';

export const listMemoriesQuerySchema = t.Object({
  projectId: t.Optional(t.String({ minLength: 1 })),
  scope: t.Optional(t.Literal(MemoryScope.Personal)),
  categories: t.Optional(t.Array(t.Enum(MemoryCategory))),
});
