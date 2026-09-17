import { t } from 'elysia';

import { RunKind } from '#types.js';

export const retryRunSchema = t.Object({
  checkpointId: t.Optional(t.String({ minLength: 1 })),
});

export const decideRunSchema = t.Object({
  toolCallId: t.String({ minLength: 1 }),
  decision: t.Union([t.Literal('approve'), t.Literal('reject')]),
});

export const queueStatusQuerySchema = t.Object({
  kind: t.Union([
    t.Literal(RunKind.MrReview),
    t.Literal(RunKind.WorkItemResolve),
    t.Literal(RunKind.TaskResolve),
  ]),
});
