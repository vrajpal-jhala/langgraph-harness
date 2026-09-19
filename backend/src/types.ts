import { Static } from 'elysia';
import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely';
import { z } from 'zod';

import {
  MemoryCandidateSchema,
  MemorySourceSchema,
} from '#components/memories/candidate.js';
import type { listThreadsQuerySchema } from './components/threads/validation.js';
import { harnessConfigSchema } from './utils/harness-config.js';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const Role = {
  Admin: 'admin',
  Viewer: 'viewer',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export type Session = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
};

// ─── LLM ──────────────────────────────────────────────────────────────────────

export const LLMProvider = {
  OpenRouter: 'openrouter',
  Ollama: 'ollama',
  Sglang: 'sglang',
} as const;

export type LLMProvider = (typeof LLMProvider)[keyof typeof LLMProvider];

export const ModelName = {
  Gpt5Mini: 'openai/gpt-5-mini',
  Gemini25FlashLite: 'google/gemini-2.5-flash-lite',
  ClaudeHaiku45: 'anthropic/claude-haiku-4.5',
  Sonnet5: 'anthropic/claude-sonnet-5',
  Qwen36: 'qwen3.6:latest',
  Qwen36_27B: 'qwen3.6:27b',
  Qwen35: 'qwen3.5:latest',
  Gemma431B: 'gemma4:31b',
  Qwen36Awq: 'QuantTrio/Qwen3.6-35B-A3B-AWQ',
  Qwen36_27BAwq: 'cyankiwi/Qwen3.6-27B-AWQ-INT4',
  Qwen38_27BFp8: 'Qwen/Qwen3.8-27B-FP8',
} as const;

export type ModelName = (typeof ModelName)[keyof typeof ModelName];

export type LLM = {
  provider: LLMProvider;
  model: ModelName;
  name: string;
  contextWindow: number;
  isDefault?: boolean;
  tokenizerRepo?: string;
};

export type SupermemoryProject = {
  name: string;
  containerTag: string;
  description: string;
};

// ─── Workflow nodes ───────────────────────────────────────────────────────────

export const WorkflowNode = {
  NotifyReviewStart: 'notify_review_start',
  LoadInstructions: 'load_instructions',
  Agent: 'agent',
  NotifyReviewEnd: 'notify_review_end',
  NotifyIssueStart: 'notify_issue_start',
  AssessCompletion: 'assess_completion',
} as const;

export type WorkflowNode = (typeof WorkflowNode)[keyof typeof WorkflowNode];

// ─── Instruction status ───────────────────────────────────────────────────────

export const InstructionStatus = {
  Loading: 'loading',
  LoadedAll: 'loaded_all',
  LoadedFiltered: 'loaded_filtered',
  Missing: 'missing',
  Failed: 'failed',
} as const;

export type InstructionStatus =
  (typeof InstructionStatus)[keyof typeof InstructionStatus];

// ─── Completion status ────────────────────────────────────────────────────────

export const CompletionStatus = {
  Done: 'done',
  Partial: 'partial',
  Blocked: 'blocked',
} as const;

export type CompletionStatus =
  (typeof CompletionStatus)[keyof typeof CompletionStatus];

// ─── Run events ───────────────────────────────────────────────────────────────

export const RunStep = {
  PrepareWorktree: 'prepare_worktree',
  SetGitIdentity: 'set_git_identity',
  SandboxCreate: 'sandbox_create',
  SandboxKill: 'sandbox_kill',
  ClassifyIssue: 'classify_issue',
  CreateBranch: 'create_branch',
  Push: 'push',
  MrCreate: 'mr_create',
  NoChanges: 'no_changes',
  AssessCompletion: 'assess_completion',
  NotifyIssueEnd: 'notify_issue_end',
  UpdateMergeRequest: 'update_merge_request',
} as const;
export type RunStep = (typeof RunStep)[keyof typeof RunStep];

export type RunStepStartEvent =
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.PrepareWorktree;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.SetGitIdentity;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.SandboxCreate;
        image: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.SandboxKill;
        sandboxId: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.ClassifyIssue;
        prompt: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.CreateBranch;
        branchName: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.Push;
        sourceBranch: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.MrCreate;
        sourceBranch: string;
        targetBranch: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.NoChanges;
        branchName: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.NotifyIssueEnd;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: typeof RunStep.UpdateMergeRequest;
        timestamp: number;
      };
    };

export type RunStepEndEvent =
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.PrepareWorktree;
        repo: string;
        ref: string;
        cloned: boolean;
        revived: boolean;
        error: string;
        retries: number;
        maxRetries: number;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.SetGitIdentity;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.SandboxCreate;
        sandboxId: string;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.SandboxKill;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.ClassifyIssue;
        type: string;
        slug: string;
        error: string;
        retries: number;
        maxRetries: number;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.CreateBranch;
        branchName: string;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.Push;
        forced: boolean;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.MrCreate;
        mrIid: string;
        mrUrl: string;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.NoChanges;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.NotifyIssueEnd;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: typeof RunStep.UpdateMergeRequest;
        completionStatus: CompletionStatus;
        completionSummary: string;
        error: string;
        timestamp: number;
      };
    };

export const RunKind = {
  MrReview: 'mr_review',
  Chat: 'chat',
  WorkItemResolve: 'work_item_resolve',
  TaskResolve: 'task_resolve',
} as const;
export type RunKind = (typeof RunKind)[keyof typeof RunKind];

export type MrReviewRunInput = {
  kind: typeof RunKind.MrReview;
  query: {
    note: string;
    projectId: string;
    mrIid: string;
    sourceBranch: string;
    sourceSha: string;
    targetBranch: string;
    defaultBranch: string;
  };
  model: ModelName;
  reasoning: boolean;
  config: ParsedHarnessConfig;
};

export type ChatRunInput = {
  kind: typeof RunKind.Chat;
  query: { message: string; images?: string[] };
  model: ModelName;
  reasoning: boolean;
  tools: { server: boolean; gitlab: boolean; webSearch: boolean };
};

export type WorkItemResolveRunInput = {
  kind: typeof RunKind.WorkItemResolve;
  projectPath: string;
  issueIid: string;
  defaultBranch: string;
  assignedBy: string;
  model: ModelName;
  config: ParsedHarnessConfig;
  issueKind: 'issue' | 'work_item';
};

export type TaskResolveRunInput = {
  kind: typeof RunKind.TaskResolve;
  title: string;
  projectPath: string;
  prompt: string;
  defaultBranch: string;
  submittedBy: string;
  model: ModelName;
  config: ParsedHarnessConfig;
};

export type RunInput =
  | MrReviewRunInput
  | ChatRunInput
  | WorkItemResolveRunInput
  | TaskResolveRunInput;

export type ResumePayload = {
  toolCallId: string;
  decision: 'approve' | 'reject';
};

// 'resume' continues past a humanApprovalMiddleware pause; 'retry' forks an earlier checkpoint.
export type RunMode =
  | { mode: 'fresh' }
  | { mode: 'retry'; fromCheckpointId: string }
  | { mode: 'resume'; decision: ResumePayload };

export type RunContext = {
  id: string;
  runId: string;
  signal: AbortSignal;
} & RunMode;

export type MessageEvent = {
  event: 'message';
  data: {
    id: string;
    content: string;
    reasoningContent: string;
    subagentId?: string;
  };
};

export type ToolInputEvent = {
  event: 'tool_input';
  data: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    timestamp: number;
    subagentId?: string;
  };
};

export type ToolOutputEvent = {
  event: 'tool_output';
  data: {
    id: string;
    output?: string;
    timestamp: number;
    subagentId?: string;
  };
};

export type NodeStartEvent = {
  event: 'node_start';
  data: { node: string; timestamp: number };
};

export type LoadInstructionsNodePayload = {
  status: HarnessConfigStatus;
  parsed: HarnessConfig | null;
  instructions: { status: InstructionStatus; content: string };
  error: string;
};

export type AssessCompletionNodePayload = {
  status: string;
  summary: string;
  error: string;
  retries: number;
  maxRetries: number;
};

export type NodeEndEvent = {
  event: 'node_end';
  data: {
    node: string;
    timestamp: number;
    payload?: LoadInstructionsNodePayload | AssessCompletionNodePayload;
  };
};

export type NodeEvent = NodeStartEvent | NodeEndEvent;

export type AgentPromptEvent = {
  event: 'agent_prompt';
  data: {
    id: string;
    systemPrompt: string;
    humanMessage: string;
    timestamp: number;
    subagentId?: string;
  };
};

export type SubagentErrorEvent = {
  event: 'subagent_error';
  data: {
    id: string;
    error: string;
    timestamp: number;
    subagentId: string;
  };
};

export type ModelRetryEvent = {
  event: 'model_retry';
  data: {
    id: string;
    count: number;
    total: number;
    error: string;
    timestamp: number;
    subagentId?: string;
  };
};

export type CorrectiveNudgeStartEvent = {
  event: 'corrective_nudge_start';
  data: {
    id: string;
    middleware:
      | 'DuplicateCallGuard'
      | 'ExtractProjectMemory'
      | 'TrailingQuestionGuard'
      | 'NoToolCallGuard'
      | 'DiscussionCheckGuard'
      | 'HumanApproval';
    prompt: string;
    timestamp: number;
    subagentId?: string;
  };
};

export type CorrectiveNudgeEndEvent = {
  event: 'corrective_nudge_end';
  data: {
    id: string;
    error: string;
    timestamp: number;
    subagentId?: string;
  };
};

export type CheckpointEvent = {
  event: 'checkpoint';
  data: { id: string };
};

export type InterruptEvent = {
  event: 'interrupt';
  data: {
    id: string;
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    timestamp: number;
  };
};

export type ContextUsageBreakdown = {
  systemPrompt: number;
  repoInstructions: number;
  projectMemories: number;
  toolSchemas: number;
  skillContent: number;
  messages: number;
  autocompactBuffer: number;
  freeSpace: number;
};

export type ContextUsageEvent = {
  event: 'context_usage';
  data: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    breakdown?: ContextUsageBreakdown;
    timestamp: number;
    subagentId?: string;
  };
};

export type LlmBackendWaitStartEvent = {
  event: 'llm_backend_wait_start';
  data: {
    id: string;
    provider: LLMProvider;
    timestamp: number;
    subagentId?: string;
  };
};

export type LlmBackendWaitEndEvent = {
  event: 'llm_backend_wait_end';
  data: {
    id: string;
    timestamp: number;
    subagentId?: string;
  };
};

export type QueueWaitEvent = {
  event: 'queue_wait';
  data: {
    waitMs: number;
    timestamp: number;
  };
};

export type SummarizeContextStartEvent = {
  event: 'summarize_context_start';
  data: {
    id: string;
    prompt: string;
    timestamp: number;
  };
};

export type SummarizeContextEndEvent = {
  event: 'summarize_context_end';
  data: {
    id: string;
    messagesBefore: number;
    messagesAfter: number;
    summary: string;
    error: string;
    retries: number;
    maxRetries: number;
    timestamp: number;
  };
};

type CriticStartEventData = {
  id: string;
  prompt: string;
  timestamp: number;
};

type CriticEndEventData = {
  id: string;
  content: string;
  verdicts: { id: string; drop: boolean }[];
  dropped: { id: string; body: string }[];
  failed: { id: string; body: string }[];
  error: string;
  retries: number;
  maxRetries: number;
  timestamp: number;
};

export type CommentCriticStartEvent = {
  event: 'comment_critic_start';
  data: CriticStartEventData;
};

export type CommentCriticEndEvent = {
  event: 'comment_critic_end';
  data: CriticEndEventData;
};

export type ReplyCriticStartEvent = {
  event: 'reply_critic_start';
  data: CriticStartEventData;
};

export type ReplyCriticEndEvent = {
  event: 'reply_critic_end';
  data: CriticEndEventData;
};

export type ExtractProjectMemoryStartEvent = {
  event: 'extract_project_memory_start';
  data: {
    id: string;
    categories: MemoryCategory[];
    prompt: string;
    timestamp: number;
  };
};

export type ExtractProjectMemoryEndEvent = {
  event: 'extract_project_memory_end';
  data: {
    id: string;
    decisions: {
      action: 'add' | 'update' | 'retire' | 'skip';
      category?: MemoryCategory;
      targetId?: string;
      candidateTitle?: string;
      matchedId?: string;
      title?: string;
      content?: string;
      evidence?: string[];
      reason?: string;
    }[];
    error: string;
    missed: number;
    retries: number;
    maxRetries: number;
    timestamp: number;
  };
};

export type RunStepEvent = RunStepStartEvent | RunStepEndEvent;

export type LangGraphEvent =
  MessageEvent | CheckpointEvent | ToolInputEvent | ToolOutputEvent;

export type WriterEvent =
  // Also in LangGraphEvent: a short-circuited wrapToolCall skips LangGraph's own on_tool_start/on_tool_end, so these get emitted manually as writer events instead.
  | ToolInputEvent
  | ToolOutputEvent
  // Native streamModes don't carry subagentId, so a sub-agent's own turns are emitted manually here instead.
  | MessageEvent
  | NodeEvent
  | AgentPromptEvent
  | SubagentErrorEvent
  | ModelRetryEvent
  | ContextUsageEvent
  | LlmBackendWaitStartEvent
  | LlmBackendWaitEndEvent
  | SummarizeContextStartEvent
  | SummarizeContextEndEvent
  | CommentCriticStartEvent
  | CommentCriticEndEvent
  | ReplyCriticStartEvent
  | ReplyCriticEndEvent
  | CorrectiveNudgeStartEvent
  | CorrectiveNudgeEndEvent
  | ExtractProjectMemoryStartEvent
  | ExtractProjectMemoryEndEvent
  | InterruptEvent;

export type WorkflowEvent = LangGraphEvent | WriterEvent;

export type RunEvent = RunStepEvent | QueueWaitEvent | WorkflowEvent;

export type Workflow<TInput, TSecrets = undefined> = {
  id: string;
  kind: RunKind;
  name: string;
  description: string;
  init: () => Promise<void>;
  cleanup: () => void | Promise<void>;
  getGraphMermaid: () => Promise<string>;
  stream: (
    input: TInput,
    ctx: RunContext,
    secrets: TSecrets,
  ) => AsyncGenerator<RunEvent>;
  onFailure?: (
    input: TInput,
    ctx: RunContext,
    isAbort: boolean,
    isTimeout: boolean,
  ) => Promise<void>;

  // Throws to deny; called for every read and every mutating action on this workflow's threads.
  checkAccess: (
    thread: Thread,
    session: Session,
    action: 'read' | 'mutate',
  ) => void;

  // Throws the workflow's own validation errors (missing key, gitlab tools enabled without a pat, ...); omit if nothing to validate.
  validateInput?: (input: TInput, secrets: TSecrets) => void;

  // 'immediate' = fire-and-forget on creation (chat); 'queued' = concurrency-limited queue, externally triggered (mr-review).
  startMode: 'immediate' | 'queued';

  // Whether a run can pause mid-stream for tool-call approval and resume via runsService.decide() — false for workflows that run unattended end-to-end (mr-review).
  interruptible: boolean;

  // Turns a POST /threads/:id/runs body (already Elysia-validated, so safe to cast) into TInput; only 'immediate' workflows define this, 'queued' ones build TInput from their own trigger instead.
  buildInput?: (threadId: string, body: unknown) => Promise<TInput>;

  // Called by threadsService.delete to clean up a pending run (e.g. a BullMQ job) before its thread is deleted; omit if nothing to clean up (chat).
  cancelPendingRun?: (run: Run) => Promise<void>;

  // Called by utils/services.ts's boot-time sweep to re-dispatch a run left QUEUED/RUNNING by a server crash; omit if crashed runs of this kind just stay failed (chat).
  recoverOrphanedRun?: (run: Run) => Promise<void>;
};

// ─── Queue Job ───────────────────────────────────────────────────────────────

// Only MR reviews are queued — chat runs are fire-and-forget, never enqueued.
export type RunJob = {
  threadId: string;
  runId: string;
  checkpointId?: string;
} & MrReviewRunInput;

// ─── Database (Kysely table interfaces) ──────────────────────────────────────

export const RunStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SUPERSEDED: 'superseded',
  INTERRUPTED: 'interrupted',
} as const;

export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

// Both timestamps are DB-managed: DEFAULT NOW() on insert, trigger on update.
type Timestamp = ColumnType<Date, never, never>;

export type ThreadMetadata = Record<string, unknown>;

export interface ThreadTable {
  id: ColumnType<string, never, never>;
  title: string;
  kind: ColumnType<RunKind, RunKind, never>;
  user_id: ColumnType<string | null, string | null | undefined, never>;
  metadata: ColumnType<ThreadMetadata | null>;
  archived_at: ColumnType<Date | null, never, Date | null>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RunTable {
  id: ColumnType<string, never, never>;
  thread_id: ColumnType<string, string, never>;
  kind: ColumnType<RunKind, RunKind, never>;
  status: ColumnType<RunStatus, never, RunStatus>;
  input: ColumnType<RunInput, RunInput, never>;
  events: ColumnType<RunEvent[], never, RunEvent[]>;
  error: ColumnType<string | null, never, string | null>;
  parent_checkpoint_id: ColumnType<
    string | null,
    string | null | undefined,
    never
  >;
  resume_payload: ColumnType<
    ResumePayload | null,
    ResumePayload | null | undefined,
    never
  >;
  started_at: ColumnType<Date | null, never, never>;
  completed_at: ColumnType<Date | null, never, never>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type ErrorKind =
  | 'timeout'
  | 'guardAbort'
  | 'manualAbort'
  | 'modelError'
  | 'serverRestart'
  | 'generationLoop';

export type NudgeStats = Record<
  string,
  { fired: number; resolved: number; escalated: number }
>;

export type CommentCriticSummary = {
  verdicts: number;
  dropped: number;
  failed: number;
  hadError: boolean;
  retries: number;
};

export type MemoryCuratorSummary = {
  added: number;
  updated: number;
  retired: number;
  skipped: number;
  missed: number;
  hadError: boolean;
  retries: number;
};

export type OwnCommentsSummary = {
  total: number;
  resolved: number;
};

export type SummarizedRunSnapshot = {
  llm_calls: number;
  tool_calls: number;
  unique_tools: number;
  repeated_tool_calls: number;
  model_retries: number;
  checkpoints: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  max_context_size: number | null;
  queue_wait_ms: number | null;
  llm_backend_wait_ms: number;
  nudge_stats: NudgeStats;
  comment_critic: CommentCriticSummary | null;
  memory_curator: MemoryCuratorSummary | null;
  own_comments: OwnCommentsSummary | null;
};

export interface RunSummaryTable {
  run_id: ColumnType<string, string, never>;
  duration_ms: ColumnType<number, number, never>;
  success: ColumnType<boolean, boolean, never>;
  error_kind: ColumnType<ErrorKind | null, ErrorKind | null | undefined, never>;
  llm_calls: ColumnType<SummarizedRunSnapshot['llm_calls'], number, never>;
  tool_calls: ColumnType<SummarizedRunSnapshot['tool_calls'], number, never>;
  unique_tools: ColumnType<
    SummarizedRunSnapshot['unique_tools'],
    number,
    never
  >;
  repeated_tool_calls: ColumnType<
    SummarizedRunSnapshot['repeated_tool_calls'],
    number,
    never
  >;
  model_retries: ColumnType<
    SummarizedRunSnapshot['model_retries'],
    number,
    never
  >;
  checkpoints: ColumnType<SummarizedRunSnapshot['checkpoints'], number, never>;
  prompt_tokens: ColumnType<
    SummarizedRunSnapshot['prompt_tokens'],
    SummarizedRunSnapshot['prompt_tokens'] | undefined,
    never
  >;
  completion_tokens: ColumnType<
    SummarizedRunSnapshot['completion_tokens'],
    SummarizedRunSnapshot['completion_tokens'] | undefined,
    never
  >;
  total_tokens: ColumnType<
    SummarizedRunSnapshot['total_tokens'],
    SummarizedRunSnapshot['total_tokens'] | undefined,
    never
  >;
  max_context_size: ColumnType<
    SummarizedRunSnapshot['max_context_size'],
    SummarizedRunSnapshot['max_context_size'] | undefined,
    never
  >;
  queue_wait_ms: ColumnType<
    SummarizedRunSnapshot['queue_wait_ms'],
    SummarizedRunSnapshot['queue_wait_ms'] | undefined,
    never
  >;
  llm_backend_wait_ms: ColumnType<
    SummarizedRunSnapshot['llm_backend_wait_ms'],
    SummarizedRunSnapshot['llm_backend_wait_ms'] | undefined,
    never
  >;
  nudge_stats: ColumnType<
    SummarizedRunSnapshot['nudge_stats'],
    SummarizedRunSnapshot['nudge_stats'],
    never
  >;
  comment_critic: ColumnType<
    SummarizedRunSnapshot['comment_critic'],
    SummarizedRunSnapshot['comment_critic'] | undefined,
    never
  >;
  memory_curator: ColumnType<
    SummarizedRunSnapshot['memory_curator'],
    SummarizedRunSnapshot['memory_curator'] | undefined,
    never
  >;
  own_comments: ColumnType<
    SummarizedRunSnapshot['own_comments'],
    SummarizedRunSnapshot['own_comments'] | undefined,
    SummarizedRunSnapshot['own_comments']
  >;
  subagent_stats: ColumnType<
    Record<string, SummarizedRunSnapshot>,
    Record<string, SummarizedRunSnapshot> | undefined,
    never
  >;
}

export const MemoryCategory = {
  knowledge: 'knowledge',
  preference: 'preference',
  lesson: 'lesson',
  decision: 'decision',
} as const;

export type MemoryCategory =
  (typeof MemoryCategory)[keyof typeof MemoryCategory];

// Object.keys() erases to string[] even for a literal-valued object — cast once here so every call site gets MemoryCategory[].
export const MEMORY_CATEGORIES = Object.keys(
  MemoryCategory,
) as MemoryCategory[];

export const MemoryScope = {
  Project: 'project',
  Personal: 'personal',
} as const;

export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

export type MemorySource = z.infer<typeof MemorySourceSchema>;

export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export interface MemoryTable {
  id: ColumnType<string, never, never>;
  project_id: ColumnType<string | null, string | null | undefined, never>;
  user_id: ColumnType<string | null, string | null | undefined, never>;
  category: MemoryCategory;
  title: string;
  content: string;
  evidence: string[];
  source: MemorySource;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type WorktreeEntityType = 'mr' | 'issue' | 'task';

export type WorktreeIdentity = {
  repo: string;
  entityType: WorktreeEntityType;
  iid: string;
};

export interface WorktreeLeaseTable {
  id: ColumnType<string, never, never>;
  repo: string;
  entity_type: WorktreeEntityType;
  iid: string;
  ref: string;
  leased: ColumnType<boolean>;
  pending_delete: ColumnType<boolean>;
  created_at: Timestamp;
  accessed_at: ColumnType<Date>;
}

export interface UserSettingsTable {
  user_id: ColumnType<string, string, never>;
  key: ColumnType<string, string, never>;
  value: string;
  updated_at: Timestamp;
}

export const ScheduleStatus = {
  Active: 'active',
  Paused: 'paused',
  Cancelled: 'cancelled',
  Completed: 'completed',
} as const;

export type ScheduleStatus =
  (typeof ScheduleStatus)[keyof typeof ScheduleStatus];

// `time` is local wall-clock ("HH:mm"), never pre-converted to UTC — `timezone` is what makes it meaningful.
export type ScheduleRecurrence =
  | { freq: 'daily'; time: string }
  | { freq: 'weekly'; time: string; daysOfWeek: number[] }
  | { freq: 'monthly'; time: string; dayOfMonth: number };

export interface TaskScheduleTable {
  id: ColumnType<string, never, never>;
  title: string;
  project_path: string;
  prompt: string;
  default_branch: string;
  created_by: string;
  // Null means one-time — `scheduled_for` alone is the fire time.
  recurrence: ColumnType<ScheduleRecurrence | null>;
  // One-time: the fire instant (UTC). Recurring: when the series was (re)started, used to recompute its next occurrence.
  scheduled_for: ColumnType<Date>;
  timezone: string;
  end_date: ColumnType<Date | null>;
  status: ColumnType<
    ScheduleStatus,
    ScheduleStatus | undefined,
    ScheduleStatus
  >;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Database {
  threads: ThreadTable;
  runs: RunTable;
  run_summaries: RunSummaryTable;
  memories: MemoryTable;
  worktree_leases: WorktreeLeaseTable;
  user_settings: UserSettingsTable;
  task_schedules: TaskScheduleTable;
}

export type TaskSchedule = Selectable<TaskScheduleTable>;
export type NewTaskSchedule = Insertable<TaskScheduleTable>;
export type TaskScheduleUpdate = Updateable<TaskScheduleTable>;

export type SearchMode = 'substring' | 'regex' | 'fuzzy';

export type Thread = Selectable<ThreadTable>;
export type ThreadWithRunStatus = Thread & {
  latest_run_status: RunStatus | null;
  latest_run_started_at: Date | null;
  latest_run_completed_at: Date | null;
};
export type NewThread = Insertable<ThreadTable>;
export type ThreadUpdate = Updateable<ThreadTable>;
export type ThreadFilters = Omit<
  Static<typeof listThreadsQuerySchema>,
  'limit' | 'offset' | 'title'
> & {
  limit: number;
  offset: number;
  // Set when the caller wants their own chat list — mr-review threads have no owner and are listed regardless of this.
  userId?: string;
  title?: { pattern: string; mode?: SearchMode };
  excludeId?: string;
};

export type Run = Selectable<RunTable>;
export type NewRun = Insertable<RunTable>;
export type RunUpdate = Updateable<RunTable>;
export type RunSummary = Selectable<RunSummaryTable>;
export type NewRunSummary = Insertable<RunSummaryTable>;

export type Memory = Selectable<MemoryTable>;
export type NewMemory = Insertable<MemoryTable>;
export type MemoryUpdate = Updateable<MemoryTable>;

export type WorktreeLease = Selectable<WorktreeLeaseTable>;
export type NewWorktreeLease = Insertable<WorktreeLeaseTable>;
export type WorktreeLeaseUpdate = Updateable<WorktreeLeaseTable>;

export type MemoryCategoryEntryMap = Record<MemoryCategory, Memory[]>;

// ─── WebSocket ───────────────────────────────────────────────────────────────
export type WSEvent = { type: 'thread:upserted'; payload: ThreadWithRunStatus };

// ─── Config ──────────────────────────────────────────────────────────────────
export type HarnessConfig = z.infer<typeof harnessConfigSchema>;

// 'missing' (no .harness.yml) vs 'invalid' (present but unusable) both mean "review with no instructions" — the distinction is only used for the MR comment.
export const HarnessConfigStatus = {
  Ok: 'ok',
  Missing: 'missing',
  Invalid: 'invalid',
} as const;

export type HarnessConfigStatus =
  (typeof HarnessConfigStatus)[keyof typeof HarnessConfigStatus];

export type ParsedHarnessConfig = {
  parsed: HarnessConfig | null;
  status: HarnessConfigStatus;
};

export type InstructionDoc = { path: string; match?: string[] };
