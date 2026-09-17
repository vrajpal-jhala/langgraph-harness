import z from 'zod';

import { MEMORY_CATEGORIES } from '#types.js';

export const MemorySourceSchema = z.discriminatedUnion('workflow', [
  z.object({ workflow: z.literal('code-review'), mrIid: z.string() }),
  z.object({ workflow: z.literal('chat'), threadId: z.string() }),
  z.object({ workflow: z.literal('work-item-resolve'), issueIid: z.string() }),
  z.object({ workflow: z.literal('task-resolve'), threadId: z.string() }),
]);

export const MemoryCandidateSchema = z.object({
  category: z
    .enum(MEMORY_CATEGORIES)
    .describe(
      'knowledge = non-obvious repo facts; preference = team conventions revealed through discussion; lesson = false positive/negative or misunderstanding worth avoiding next time; decision = durable engineering decisions',
    ),
  title: z.string().describe('Short title for this fact'),
  content: z
    .string()
    .describe(
      "The fact itself, with enough detail to be useful without this run's context",
    ),
  evidence: z
    .array(z.string())
    .default([])
    .describe(
      'Direct quotes or references backing this up, e.g. a thread reply',
    ),
  source: MemorySourceSchema,
});
