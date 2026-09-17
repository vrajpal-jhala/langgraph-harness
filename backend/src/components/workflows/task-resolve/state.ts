import type { BaseMessage } from '@langchain/core/messages';
import { MessagesValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

import {
  CompletionStatus,
  InstructionStatus,
  type ParsedHarnessConfig,
} from '#types.js';

import { BRANCH_TYPES } from '#components/workflows/branch-naming.js';

import { config, llms } from '#utils/config.js';

const repoInstructionsSchema = z.string().max(config.instructions.maxChars);

const taskResolveStateSchema = z.object({
  title: z.string(),
  projectPath: z.string(),
  prompt: z.string(),
  taskType: z.enum(BRANCH_TYPES),
  defaultBranch: z.string(),
  model: z.enum(llms.map((m) => m.model)),
  messages: MessagesValue,
  lastRunReplyNoteIds: z.array(z.string()).optional().default([]),
  completionStatus: z.enum(CompletionStatus).optional(),
  completionSummary: z.string().optional(),
  config: z.object({
    status: z.custom<ParsedHarnessConfig['status']>(),
    parsed: z.custom<ParsedHarnessConfig['parsed']>(),
    instructions: z.object({
      status: z.enum(InstructionStatus),
      content: repoInstructionsSchema.optional().default(''),
    }),
  }),
});

export const taskResolveState = new StateSchema(taskResolveStateSchema.shape);

// `messages`'s real type comes from the `MessagesValue` channel, not the zod
// schema — z.infer can't see through it and would otherwise widen it to `unknown`.
export type TaskResolveState = Omit<
  z.infer<typeof taskResolveStateSchema>,
  'messages'
> & { messages: BaseMessage[] };
