export const Role = {
  Admin: 'admin',
  Viewer: 'viewer',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const RunKind = {
  MrReview: 'mr_review',
  Chat: 'chat',
  WorkItemResolve: 'work_item_resolve',
  TaskResolve: 'task_resolve',
} as const;
export type RunKind = (typeof RunKind)[keyof typeof RunKind];

export type Thread = {
  id: string;
  title: string;
  metadata: Record<string, unknown> | null;
  latest_run_status: RunStatus | null;
  latest_run_started_at: Date | null;
  latest_run_completed_at: Date | null;
  run_count: number;
  failure_count: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  // not shown in UI
  | 'superseded';

export type Queue = {
  active: number;
  waiting: number;
  delayed: number;
  jobs: {
    runId?: string;
    threadId: string;
    state: string;
    delayRemaining?: number;
  }[];
};

export type MrReviewRunInput = {
  kind: 'mr_review';
  query: {
    note: string;
    projectId: string;
    mrIid: string;
  };
  model: string;
  reasoning: boolean;
};

export type ChatRunInput = {
  kind: 'chat';
  query: { message: string; images?: string[] };
  model: string;
  reasoning: boolean;
  tools: { server: boolean; gitlab: boolean; webSearch: boolean };
};

export type WorkItemResolveRunInput = {
  kind: 'work_item_resolve';
  projectPath: string;
  issueIid: string;
  defaultBranch: string;
  model: string;
  assignedBy: string;
};

export type TaskResolveRunInput = {
  kind: 'task_resolve';
  title: string;
  projectPath: string;
  prompt: string;
  defaultBranch: string;
  model: string;
  submittedBy: string;
};

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

export type TaskSchedule = {
  id: string;
  title: string;
  project_path: string;
  prompt: string;
  default_branch: string;
  created_by: string;
  recurrence: ScheduleRecurrence | null;
  scheduled_for: Date;
  timezone: string;
  end_date: Date | null;
  status: ScheduleStatus;
  created_at: Date;
  updated_at: Date;
  nextRun: Date | null;
  repoUrl: string;
};

export type RunInput =
  | MrReviewRunInput
  | ChatRunInput
  | WorkItemResolveRunInput
  | TaskResolveRunInput;

export const MemoryCategory = {
  knowledge: 'knowledge',
  preference: 'preference',
  lesson: 'lesson',
  decision: 'decision',
} as const;

export type MemoryCategory =
  (typeof MemoryCategory)[keyof typeof MemoryCategory];

export const MEMORY_CATEGORIES = Object.keys(
  MemoryCategory,
) as MemoryCategory[];

export const MemoryScope = {
  Project: 'project',
  Personal: 'personal',
} as const;

export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

export type MemorySource =
  | { workflow: 'code-review'; mrIid: string }
  | { workflow: 'chat'; threadId: string }
  | { workflow: 'work-item-resolve'; issueIid: string };

export type Memory = {
  id: string;
  project_id: string | null;
  user_id: string | null;
  category: MemoryCategory;
  title: string;
  content: string;
  evidence: string[];
  source: MemorySource;
  created_at: Date;
  updated_at: Date;
};

export type MemoryCategoryEntryMap = Record<MemoryCategory, Memory[]>;

export type LoadInstructionsNodePayload = {
  status: string;
  parsed: {
    version: number;
    mr_review_instructions: { path: string; match?: string[] }[];
    work_item_resolve_instructions: { path: string; match?: string[] }[];
    exclude_branches: { source: string[]; target: string[] };
    mr_review_requires_harness_reviewer: boolean;
  } | null;
  instructions: { status: string; content: string };
  error: string;
};

export type AssessCompletionNodePayload = {
  status: string;
  summary: string;
  error: string;
  retries: number;
  maxRetries: number;
};

export type RunStepStartEvent =
  | {
      event: 'run_step_start';
      data: { id: string; step: 'prepare_worktree'; timestamp: number };
    }
  | {
      event: 'run_step_start';
      data: { id: string; step: 'set_git_identity'; timestamp: number };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'notify_issue_end';
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'sandbox_create';
        image: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'sandbox_kill';
        sandboxId: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'classify_issue';
        prompt: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'create_branch';
        branchName: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'push';
        sourceBranch: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'mr_create';
        sourceBranch: string;
        targetBranch: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'no_changes';
        branchName: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'assess_completion';
        prompt: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_start';
      data: {
        id: string;
        step: 'update_merge_request';
        timestamp: number;
      };
    };

export type RunStepEndEvent =
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: 'prepare_worktree';
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
        step: 'notify_issue_end';
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: 'set_git_identity';
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: 'sandbox_create';
        sandboxId: string;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: 'sandbox_kill';
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: 'classify_issue';
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
        step: 'create_branch';
        branchName: string;
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: 'push';
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: 'mr_create';
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
        step: 'no_changes';
        error: string;
        timestamp: number;
      };
    }
  | {
      event: 'run_step_end';
      data: {
        id: string;
        step: 'assess_completion';
        status: string;
        summary: string;
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
        step: 'update_merge_request';
        completionStatus: 'done' | 'partial' | 'blocked';
        completionSummary: string;
        error: string;
        timestamp: number;
      };
    };

export type RunStepEvent = RunStepStartEvent | RunStepEndEvent;

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

export type WorkflowEvent =
  | {
      event: 'message';
      data: {
        id: string;
        content: string;
        reasoningContent: string;
        subagentId?: string;
      };
    }
  | {
      event: 'tool_input';
      data: {
        id: string;
        name: string;
        input: Record<string, unknown>;
        timestamp: number;
        subagentId?: string;
      };
    }
  | {
      event: 'tool_output';
      data: {
        id: string;
        output?: string;
        timestamp: number;
        subagentId?: string;
      };
    }
  | {
      event: 'node_start';
      data: { node: string; timestamp: number };
    }
  | {
      event: 'node_end';
      data: {
        node: string;
        timestamp: number;
        payload?: LoadInstructionsNodePayload | AssessCompletionNodePayload;
      };
    }
  | {
      event: 'agent_prompt';
      data: {
        id: string;
        systemPrompt: string;
        humanMessage: string;
        timestamp: number;
        subagentId?: string;
      };
    }
  | {
      event: 'subagent_error';
      data: {
        id: string;
        error: string;
        timestamp: number;
        subagentId: string;
      };
    }
  | {
      event: 'model_retry';
      data: {
        id: string;
        count: number;
        total: number;
        error: string;
        timestamp: number;
        subagentId?: string;
      };
    }
  | {
      event: 'checkpoint';
      data: { id: string };
    }
  | {
      event: 'interrupt';
      data: {
        id: string;
        toolCallId: string;
        name: string;
        args: Record<string, unknown>;
        timestamp: number;
      };
    }
  | {
      event: 'context_usage';
      data: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        breakdown?: ContextUsageBreakdown;
        timestamp: number;
        subagentId?: string;
      };
    }
  | {
      event: 'llm_backend_wait_start';
      data: {
        id: string;
        provider: LLMProvider;
        timestamp: number;
        subagentId?: string;
      };
    }
  | {
      event: 'llm_backend_wait_end';
      data: {
        id: string;
        timestamp: number;
        subagentId?: string;
      };
    }
  | {
      event: 'queue_wait';
      data: {
        waitMs: number;
        timestamp: number;
      };
    }
  | {
      event: 'summarize_context_start';
      data: {
        id: string;
        prompt: string;
        timestamp: number;
      };
    }
  | {
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
    }
  | {
      event: 'comment_critic_start';
      data: {
        id: string;
        prompt: string;
        timestamp: number;
      };
    }
  | {
      event: 'comment_critic_end';
      data: {
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
    }
  | {
      event: 'reply_critic_start';
      data: {
        id: string;
        prompt: string;
        timestamp: number;
      };
    }
  | {
      event: 'reply_critic_end';
      data: {
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
    }
  | {
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
    }
  | {
      event: 'corrective_nudge_end';
      data: {
        id: string;
        error: string;
        timestamp: number;
        subagentId?: string;
      };
    }
  | {
      event: 'extract_project_memory_start';
      data: {
        id: string;
        categories: MemoryCategory[];
        prompt: string;
        timestamp: number;
      };
    }
  | {
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

export type RunEvent = RunStepEvent | WorkflowEvent;

export type ResumePayload = {
  toolCallId: string;
  decision: 'approve' | 'reject';
};

export type Run = {
  id: string;
  thread_id: string;
  status: RunStatus;
  input: RunInput;
  events: RunEvent[];
  error: string | null;
  parent_checkpoint_id: string | null;
  resume_payload: ResumePayload | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type Todo = {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
};

export const LLMProvider = {
  OpenRouter: 'openrouter',
  Ollama: 'ollama',
  Sglang: 'sglang',
} as const;

export type LLMProvider = (typeof LLMProvider)[keyof typeof LLMProvider];

export type LLM = {
  provider: LLMProvider;
  model: string;
  name: string;
  contextWindow: number;
  isDefault?: boolean;
};

export type WorkflowStatus = 'idle' | 'queued' | 'running';

export type Workflow = {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  totalRuns: number;
  activeRuns: number;
  lastRunAt: Date | null;
  startMode: 'immediate' | 'queued';
  interruptible: boolean;
};
