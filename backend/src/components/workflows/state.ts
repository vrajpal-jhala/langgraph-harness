import type { Sandbox } from '@alibaba-group/opensandbox';
import { z } from 'zod';

import type { MemoryCandidate } from '#types.js';

// Mutable per-run scratch state shared by the sandboxed resolve workflows — reset fresh on every invoke, discarded after; never checkpointed or inspected later.
type BaseSandboxAgentConfigurable = {
  sandbox: Sandbox;
  workingDirectory: string;
  worktreePath: string;
  projectId: string;
  mrIid: string | null;
  threadId: string;
  toolCallCounts: Map<string, number>;
  toolErrorCounts: Map<string, number>;
  toolCallMade: { called: boolean };
  memoryCandidates: MemoryCandidate[];
  memoryReflectNudged: { nudged: boolean };
  noToolCallNudged: { nudged: boolean };
  trailingQuestionNudged: { nudged: boolean };
  discussionCheckNudged: { nudged: boolean };
  postedReplyNoteIds: string[];
};

export type WorkItemResolveAgentConfigurable = BaseSandboxAgentConfigurable & {
  workflow: 'work-item-resolve';
  issueIid: string;
};

export type TaskResolveAgentConfigurable = BaseSandboxAgentConfigurable & {
  workflow: 'task-resolve';
};

// Generic consumers (tools, middleware) that don't care which workflow is running accept either.
export type SandboxAgentConfigurable =
  WorkItemResolveAgentConfigurable | TaskResolveAgentConfigurable;

export type SandboxAgentRuntime = {
  configurable?: Partial<SandboxAgentConfigurable>;
  signal?: AbortSignal;
};

// Immutable per-run values tools and middleware read via runtime.context.
export const sandboxAgentToolContextSchema = z.object({
  systemPrompt: z.string(),
});

export type SandboxAgentToolContext = z.infer<
  typeof sandboxAgentToolContextSchema
>;
