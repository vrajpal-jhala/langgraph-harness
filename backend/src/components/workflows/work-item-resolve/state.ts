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

// Backstop cap at the schema level; resolveInstructionDocs truncates before this.
const repoInstructionsSchema = z.string().max(config.instructions.maxChars);

const workflowStateSchema = z.object({
  projectPath: z.string(),
  issueIid: z.string(),
  issueTitle: z.string(),
  issueDescription: z.string(),
  issueType: z.enum(BRANCH_TYPES),
  defaultBranch: z.string(),
  model: z.enum(llms.map((m) => m.model)),
  messages: MessagesValue,
  noteId: z.number().optional(),
  lastRunReplyNoteIds: z.array(z.string()).optional().default([]),
  completionStatus: z.enum(CompletionStatus).optional(),
  completionSummary: z.string().optional(),
  // Repo config + parse status, resolved in the webhook route and passed in as
  // workflow input (checkpointed, so a retry keeps it). The load_instructions
  // node consumes this; it never re-fetches the config.
  config: z.object({
    status: z.custom<ParsedHarnessConfig['status']>(),
    parsed: z.custom<ParsedHarnessConfig['parsed']>(),
    instructions: z.object({
      status: z.enum(InstructionStatus),
      content: repoInstructionsSchema.optional().default(''),
    }),
  }),
});

export const workflowState = new StateSchema(workflowStateSchema.shape);

// `messages`'s real type comes from the `MessagesValue` channel, not the zod
// schema — z.infer can't see through it and would otherwise widen it to `unknown`.
export type WorkflowState = Omit<
  z.infer<typeof workflowStateSchema>,
  'messages'
> & { messages: BaseMessage[] };
