import { MessagesValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

import {
  InstructionStatus,
  type MemoryCandidate,
  type ParsedHarnessConfig,
} from '#types.js';

import { config, llms } from '#utils/config.js';
import type { DiffLineMap } from '#utils/diff.js';

// Backstop cap at the schema level; resolveInstructions truncates before this.
const repoInstructionsSchema = z.string().max(config.instructions.maxChars);

const workflowStateSchema = z.object({
  query: z.object({
    note: z.string(),
    projectId: z.string(),
    mrIid: z.string(),
    sourceBranch: z.string(),
    targetBranch: z.string(),
    defaultBranch: z.string(),
  }),
  reasoning: z.boolean().optional().default(false),
  model: z.enum(llms.map((m) => m.model) as [string, ...string[]]),
  messages: MessagesValue,
  noteId: z.number().optional(),
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

export type WorkflowState = z.infer<typeof workflowStateSchema>;

export type DraftPosition = {
  new_path: string;
  old_line: number | null;
  new_line: number | null;
  body: string;
};

// Mutable per-run scratch state — reset fresh on every invoke, discarded after; never checkpointed or inspected later.
export type WorkflowConfigurable = {
  toolCallCounts: Map<string, number>;
  toolErrorCounts: Map<string, number>;
  toolCallMade: { called: boolean };
  draftNotes: Map<string, { id: string; body: string }>;
  commentCriticScreenedIds: Set<string>;
  memoryCandidates: MemoryCandidate[];
  memoryReflectNudged: { nudged: boolean };
  noToolCallNudged: { nudged: boolean };
  trailingQuestionNudged: { nudged: boolean };
  projectId: string;
  mrIid: string;
  diffLineMapCache: Map<string, DiffLineMap>;
  draftPositions: Map<string, DraftPosition>;
  draftTrackingStartedAt?: string;
  worktreePath: string;
  sourceBranch: string;
  targetBranch: string;
  revived: boolean;
  model: string;
  reasoning: boolean;
};

export type WorkflowRuntime = {
  configurable?: Partial<WorkflowConfigurable>;
  signal?: AbortSignal;
};

export type VerifierAgentConfigurable = {
  worktreePath: string;
  subagentId: string;
  toolCallCounts: Map<string, number>;
  toolErrorCounts: Map<string, number>;
  trailingQuestionNudged: { nudged: boolean };
  toolCallMade: { called: boolean };
  noToolCallNudged: { nudged: boolean };
};

// Immutable per-run values tools and middleware read via runtime.context.
export const mrReviewToolContextSchema = z.object({
  systemPrompt: z.string(),
});

export type MrReviewToolContext = z.infer<typeof mrReviewToolContextSchema>;
