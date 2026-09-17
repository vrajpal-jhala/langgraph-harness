import { config } from './config';
import type {
  ChatRunInput,
  MrReviewRunInput,
  Run,
  RunInput,
  TaskResolveRunInput,
  WorkItemResolveRunInput,
} from './types';

export function formatDate(
  date: Date | string | null,
): { display: string; full: string } | null {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const full = d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  let display: string;
  if (d.toDateString() === now.toDateString()) {
    display = d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } else if (d.getFullYear() === now.getFullYear()) {
    display = d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
  } else {
    display = d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  return { display, full };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const getCollapsibleIds = (runs: Run[]): string[] =>
  runs.flatMap((run) =>
    run.events.flatMap((e) =>
      e.event === 'run_step_start' ||
      e.event === 'tool_input' ||
      e.event === 'message' ||
      e.event === 'model_retry' ||
      e.event === 'summarize_context_start' ||
      e.event === 'comment_critic_start' ||
      e.event === 'reply_critic_start' ||
      e.event === 'corrective_nudge_start' ||
      e.event === 'extract_project_memory_start' ||
      e.event === 'agent_prompt'
        ? [e.data.id]
        : e.event === 'node_end' && e.data.payload
          ? [`node:${run.id}:${e.data.node}`]
          : [],
    ),
  );

/**
 * Context size right now = the last LLM call's total (prompt + completion), since the completion becomes part of the conversation the next call sends back.
 * precedingTotal is the carried-over total from the last run in this thread that had any usage — a run's first call re-sends that whole prior conversation, so without it the first delta would count the carried-over history as "new".
 */
export function getRunContextUsage(run: Run, precedingTotal = 0) {
  const events = run.events.filter((e) => e.event === 'context_usage');

  if (!events.length) return null;

  const last = events[events.length - 1];
  const prev = events[events.length - 2];
  const baseline = prev ? prev.data.totalTokens : precedingTotal;

  return {
    totalTokens: last.data.totalTokens,
    deltaTokens: last.data.totalTokens - baseline,
  };
}

export function formatTokenCount(n: number, showSign = false): string {
  const abs = Math.abs(n);
  const sign = showSign && n >= 0 ? '+' : '';
  if (abs < 1000) return `${sign}${n}`;
  if (abs < 1_000_000) return `${sign}${(n / 1000).toFixed(1)}k`;
  return `${sign}${(n / 1_000_000).toFixed(2)}M`;
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function resolveUploadUrl(ref: string): string {
  return `${config.apiUrl}${ref}`;
}

export const isChatRunInput = (input: RunInput): input is ChatRunInput =>
  input.kind === 'chat';

export const isMrReviewRunInput = (
  input: RunInput,
): input is MrReviewRunInput => input.kind === 'mr_review';

export const isWorkItemResolveRunInput = (
  input: RunInput,
): input is WorkItemResolveRunInput => input.kind === 'work_item_resolve';

export const isTaskResolveRunInput = (
  input: RunInput,
): input is TaskResolveRunInput => input.kind === 'task_resolve';

export const getRunMode = (run: Run): 'fresh' | 'retry' | 'resume' =>
  run.resume_payload ? 'resume' : run.parent_checkpoint_id ? 'retry' : 'fresh';

export function getContextMeter(
  usage: { totalTokens: number; contextWindow: number } | null,
  scopeLabel: string,
): {
  percent: number | null;
  color: 'gray' | 'green' | 'yellow' | 'orange' | 'red';
  tooltipLabel: string;
} {
  const percent = usage
    ? Math.round((usage.totalTokens / usage.contextWindow) * 100)
    : null;
  const color =
    percent === null
      ? 'gray'
      : percent < 70
        ? 'green'
        : percent < 90
          ? 'yellow'
          : percent < 100
            ? 'orange'
            : 'red';
  const tooltipLabel = usage
    ? `${formatTokenCount(usage.totalTokens)} / ${formatTokenCount(usage.contextWindow)} tokens used in this ${scopeLabel}`
    : '';
  return { percent, color, tooltipLabel };
}
