import { t } from 'elysia';

import { RunKind } from '#types.js';

export const analyticsOverviewQuerySchema = t.Object({
  kind: t.Enum(RunKind),
  since: t.Optional(t.String()),
});

export const analyticsByRepoQuerySchema = t.Object({
  kind: t.Enum(RunKind),
  since: t.Optional(t.String()),
  projectId: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Numeric({ minimum: 0 })),
});

export const analyticsTrendQuerySchema = t.Object({
  kind: t.Enum(RunKind),
  since: t.Optional(t.String()),
});
