import type {
  CommentCriticSummary,
  MemoryCuratorSummary,
  NewRunSummary,
  NudgeStats,
  OwnCommentsSummary,
  RunEvent,
  SummarizedRunSnapshot,
  ToolCallSpec,
} from '#types.js';
import { GitProvider } from '#types.js';

import { config } from '#utils/config.js';
import { matchesToolCall, mcpToolName } from '#utils/helpers.js';

export type SummarizedRunFields = Omit<
  NewRunSummary,
  'run_id' | 'duration_ms' | 'success' | 'error_kind'
>;

const toolCallKey = (name: string, input: unknown) =>
  `${name}|${JSON.stringify(input ?? {})}`;

// Shared accumulation logic for both the root run and each sub-agent category, so their stats stay fully comparable.
function createAccumulator() {
  let llmCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let maxContextSize = 0;

  let toolCalls = 0;
  let repeatedToolCalls = 0;
  const seenToolCalls = new Set<string>();
  const uniqueTools = new Set<string>();

  let modelRetries = 0;
  let checkpoints = 0;

  let queueWaitMs: number | null = null;
  let llmBackendWaitMs = 0;
  const pendingBackendWaitStart = new Map<string, number>();

  const nudgeStats: NudgeStats = {};
  const pendingNudgeMiddleware = new Map<string, string>();

  return {
    recordContextUsage(data: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }) {
      llmCalls++;
      promptTokens += data.promptTokens;
      completionTokens += data.completionTokens;
      totalTokens += data.totalTokens;
      maxContextSize = Math.max(maxContextSize, data.promptTokens);
    },
    recordToolInput(name: string, input: unknown) {
      toolCalls++;
      uniqueTools.add(name);
      const key = toolCallKey(name, input);
      if (seenToolCalls.has(key)) repeatedToolCalls++;
      else seenToolCalls.add(key);
    },
    recordQueueWait(waitMs: number) {
      queueWaitMs = waitMs;
    },
    startBackendWait(id: string, timestamp: number) {
      pendingBackendWaitStart.set(id, timestamp);
    },
    endBackendWait(id: string, timestamp: number) {
      const waitingSince = pendingBackendWaitStart.get(id);
      // A run killed mid-wait never emits `_end`, so its unpaired start contributes nothing.
      if (waitingSince === undefined) return;
      pendingBackendWaitStart.delete(id);
      llmBackendWaitMs += timestamp - waitingSince;
    },
    recordModelRetry() {
      modelRetries++;
    },
    recordCheckpoint() {
      checkpoints++;
    },
    startNudge(id: string, middleware: string) {
      pendingNudgeMiddleware.set(id, middleware);
      nudgeStats[middleware] ??= { fired: 0, resolved: 0, escalated: 0 };
      nudgeStats[middleware].fired++;
    },
    endNudge(id: string, error: string) {
      const middleware = pendingNudgeMiddleware.get(id);
      if (!middleware) return;
      pendingNudgeMiddleware.delete(id);
      if (error) nudgeStats[middleware].escalated++;
      else nudgeStats[middleware].resolved++;
    },
    finish(): SummarizedRunSnapshot {
      return {
        llm_calls: llmCalls,
        tool_calls: toolCalls,
        unique_tools: uniqueTools.size,
        repeated_tool_calls: repeatedToolCalls,
        model_retries: modelRetries,
        checkpoints,
        prompt_tokens: llmCalls ? promptTokens : null,
        completion_tokens: llmCalls ? completionTokens : null,
        total_tokens: llmCalls ? totalTokens : null,
        max_context_size: llmCalls ? maxContextSize : null,
        queue_wait_ms: queueWaitMs,
        llm_backend_wait_ms: llmBackendWaitMs,
        nudge_stats: nudgeStats,
        comment_critic: null,
        memory_curator: null,
        own_comments: null,
      };
    },
  };
}

type GitlabDiscussionNote = {
  resolvable?: boolean;
  resolved?: boolean;
  created_at?: string;
  author?: { username?: string };
};

type GithubReviewThread = {
  is_resolved?: boolean;
  comments?: { author?: string; created_at?: string }[];
};

type ThreadHead = { resolved?: boolean; author?: string; createdAt?: string };

// Each thread's opening comment, from the provider's thread-listing output.
const THREAD_HEADS: Record<GitProvider, (parsed: unknown) => ThreadHead[]> = {
  [GitProvider.GitLab]: (parsed) =>
    ((parsed as { items?: { notes?: GitlabDiscussionNote[] }[] }).items ?? [])
      .map((item) => item.notes?.[0])
      .filter((note) => !!note?.resolvable)
      .map((note) => ({
        resolved: note?.resolved,
        author: note?.author?.username,
        createdAt: note?.created_at,
      })),
  [GitProvider.GitHub]: (parsed) =>
    (
      (parsed as { review_threads?: GithubReviewThread[] }).review_threads ?? []
    ).map((thread) => ({
      resolved: thread.is_resolved,
      author: thread.comments?.[0]?.author,
      createdAt: thread.comments?.[0]?.created_at,
    })),
};

const OWN_COMMENTS_READS: Record<GitProvider, ToolCallSpec> = {
  [GitProvider.GitLab]: {
    name: mcpToolName(GitProvider.GitLab, 'mr_discussions'),
  },
  [GitProvider.GitHub]: {
    name: mcpToolName(GitProvider.GitHub, 'pull_request_read'),
    method: 'get_review_comments',
  },
};

export function parseOwnComments(
  provider: GitProvider,
  output: string | undefined,
  runStartedAtMs?: number,
): OwnCommentsSummary | null {
  const { username } = config[provider];
  if (!username || !output) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }

  const own = THREAD_HEADS[provider](parsed).filter(
    (head) =>
      head.author?.toLowerCase() === username &&
      // A comment from this run is guaranteed unresolved, not a real observation.
      (runStartedAtMs === undefined ||
        !head.createdAt ||
        Date.parse(head.createdAt) < runStartedAtMs),
  );

  return {
    total: own.length,
    resolved: own.filter((head) => head.resolved).length,
  };
}

// Walks a run's full event stream once and derives every metric that doesn't need external context (run_id/duration/success/errorKind are supplied by the caller, which already knows them).
export function summarizeRun(
  events: RunEvent[],
  runStartedAtMs?: number,
): SummarizedRunFields {
  const root = createAccumulator();
  // Only one sub-agent category exists today (Verifier) — a real subagentId → category mapping needs the category threaded onto the event data if/when a second category is added.
  const subagents = new Map<string, ReturnType<typeof createAccumulator>>();
  const accumulatorFor = (subagentId: string | undefined) => {
    if (!subagentId) return root;
    const category = 'Verifier';
    let acc = subagents.get(category);
    if (!acc) subagents.set(category, (acc = createAccumulator()));
    return acc;
  };

  let commentCritic: CommentCriticSummary | null = null;
  let memoryCurator: MemoryCuratorSummary | null = null;
  let ownComments: OwnCommentsSummary | null = null;
  let sawCommentCriticStart = false;
  let sawExtractProjectMemoryStart = false;
  const pendingThreadReads = new Map<string, GitProvider>();

  for (const event of events) {
    switch (event.event) {
      case 'comment_critic_start':
      case 'reply_critic_start': {
        sawCommentCriticStart = true;
        break;
      }
      case 'extract_project_memory_start': {
        sawExtractProjectMemoryStart = true;
        break;
      }
      case 'context_usage': {
        accumulatorFor(event.data.subagentId).recordContextUsage(event.data);
        break;
      }
      case 'tool_input': {
        accumulatorFor(event.data.subagentId).recordToolInput(
          event.data.name,
          event.data.input,
        );
        const threadsProvider = (
          Object.keys(OWN_COMMENTS_READS) as GitProvider[]
        ).find((provider) =>
          matchesToolCall(OWN_COMMENTS_READS[provider], {
            name: event.data.name,
            args: event.data.input,
          }),
        );
        if (threadsProvider)
          pendingThreadReads.set(event.data.id, threadsProvider);
        break;
      }
      case 'tool_output': {
        const threadsProvider = pendingThreadReads.get(event.data.id);
        if (!threadsProvider) break;
        pendingThreadReads.delete(event.data.id);
        // Last one wins — a run rarely calls this more than once, but the latest snapshot is the freshest if it does.
        const parsed = parseOwnComments(
          threadsProvider,
          event.data.output,
          runStartedAtMs,
        );
        if (parsed) ownComments = parsed;
        break;
      }
      case 'queue_wait': {
        root.recordQueueWait(event.data.waitMs);
        break;
      }
      case 'llm_backend_wait_start': {
        accumulatorFor(event.data.subagentId).startBackendWait(
          event.data.id,
          event.data.timestamp,
        );
        break;
      }
      case 'llm_backend_wait_end': {
        accumulatorFor(event.data.subagentId).endBackendWait(
          event.data.id,
          event.data.timestamp,
        );
        break;
      }
      case 'model_retry': {
        accumulatorFor(event.data.subagentId).recordModelRetry();
        break;
      }
      case 'checkpoint': {
        root.recordCheckpoint();
        break;
      }
      case 'corrective_nudge_start': {
        accumulatorFor(event.data.subagentId).startNudge(
          event.data.id,
          event.data.middleware,
        );
        break;
      }
      case 'corrective_nudge_end': {
        accumulatorFor(event.data.subagentId).endNudge(
          event.data.id,
          event.data.error,
        );
        break;
      }
      case 'comment_critic_end':
      case 'reply_critic_end': {
        const { verdicts, dropped, failed, error, retries } = event.data;
        // Last one wins — the critic screens once per run in practice, but this stays correct if that ever changes.
        // verdicts/retries didn't exist on this event before 2026-07-09/07-15 — historical runs can still carry the older shape.
        commentCritic = {
          verdicts: verdicts?.length ?? 0,
          dropped: dropped?.length ?? 0,
          failed: failed?.length ?? 0,
          hadError: !!error,
          retries: retries ?? 0,
        };
        break;
      }
      case 'extract_project_memory_end': {
        const { decisions, missed, error, retries } = event.data;
        // decisions/missed/retries were added to this event across several revisions — historical runs can predate any of them.
        memoryCurator = {
          added: (decisions ?? []).filter((d) => d.action === 'add').length,
          updated: (decisions ?? []).filter((d) => d.action === 'update')
            .length,
          retired: (decisions ?? []).filter((d) => d.action === 'retire')
            .length,
          skipped: (decisions ?? []).filter((d) => d.action === 'skip').length,
          missed: missed ?? 0,
          hadError: !!error,
          retries: retries ?? 0,
        };
        break;
      }
      default:
        break;
    }
  }

  // A hung critic/curator call never emits `_end`, so null here means never finished, not never started.
  if (sawCommentCriticStart && !commentCritic) {
    commentCritic = {
      verdicts: 0,
      dropped: 0,
      failed: 0,
      hadError: true,
      retries: 0,
    };
  }
  if (sawExtractProjectMemoryStart && !memoryCurator) {
    memoryCurator = {
      added: 0,
      updated: 0,
      retired: 0,
      skipped: 0,
      missed: 0,
      hadError: true,
      retries: 0,
    };
  }

  return {
    ...root.finish(),
    comment_critic: commentCritic,
    memory_curator: memoryCurator,
    own_comments: ownComments,
    subagent_stats: Object.fromEntries(
      [...subagents].map(([category, acc]) => [category, acc.finish()]),
    ),
  };
}
