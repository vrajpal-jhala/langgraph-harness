import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { Runtime } from 'langchain';

import type {
  AgentPromptEvent,
  CommentCriticEndEvent,
  CommentCriticStartEvent,
  ContextUsageEvent,
  CorrectiveNudgeEndEvent,
  CorrectiveNudgeStartEvent,
  ExtractProjectMemoryEndEvent,
  ExtractProjectMemoryStartEvent,
  InterruptEvent,
  LlmBackendWaitEndEvent,
  LlmBackendWaitStartEvent,
  MessageEvent,
  ModelRetryEvent,
  NodeEvent,
  ReplyCriticEndEvent,
  ReplyCriticStartEvent,
  SummarizeContextEndEvent,
  SummarizeContextStartEvent,
  ToolInputEvent,
  ToolOutputEvent,
} from '#types.js';

export function emitNodeLifecycleEvents<T extends NodeEvent['event']>(
  config: LangGraphRunnableConfig,
  event: {
    event: T;
    data: Omit<Extract<NodeEvent, { event: T }>['data'], 'timestamp'>;
  },
) {
  config.writer?.({
    event: event.event,
    data: { ...event.data, timestamp: Date.now() },
  } satisfies NodeEvent);
}

export function emitAgentPromptEvent(
  config: LangGraphRunnableConfig,
  data: Omit<AgentPromptEvent['data'], 'timestamp'>,
) {
  config.writer?.({
    event: 'agent_prompt',
    data: { ...data, timestamp: Date.now() },
  } satisfies AgentPromptEvent);
}

export function emitContextUsageEvent(
  runtime: Runtime,
  data: Omit<ContextUsageEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'context_usage',
    data: { ...data, timestamp: Date.now() },
  } satisfies ContextUsageEvent);
}

export function emitLlmBackendWaitStartEvent(
  runtime: Runtime,
  data: Omit<LlmBackendWaitStartEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'llm_backend_wait_start',
    data: { ...data, timestamp: Date.now() },
  } satisfies LlmBackendWaitStartEvent);
}

export function emitLlmBackendWaitEndEvent(
  runtime: Runtime,
  data: Omit<LlmBackendWaitEndEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'llm_backend_wait_end',
    data: { ...data, timestamp: Date.now() },
  } satisfies LlmBackendWaitEndEvent);
}

export function emitInterruptEvent(
  runtime: Runtime,
  data: Omit<InterruptEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'interrupt',
    data: { ...data, timestamp: Date.now() },
  } satisfies InterruptEvent);
}

export function emitSummarizeContextStartEvent(
  runtime: Runtime,
  data: SummarizeContextStartEvent['data'],
) {
  runtime.writer?.({
    event: 'summarize_context_start',
    data,
  } satisfies SummarizeContextStartEvent);
}

export function emitSummarizeContextEndEvent(
  runtime: Runtime,
  data: Omit<SummarizeContextEndEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'summarize_context_end',
    data: { ...data, timestamp: Date.now() },
  } satisfies SummarizeContextEndEvent);
}

export function emitModelRetryEvents(
  runtime: Runtime,
  data: {
    id: ModelRetryEvent['data']['id'];
    attempt: ModelRetryEvent['data']['count'];
    maxRetries: ModelRetryEvent['data']['total'];
    error: unknown;
    subagentId?: string;
  },
) {
  const { id, attempt, maxRetries, error, subagentId } = data;

  runtime.writer?.({
    event: 'model_retry',
    data: {
      id,
      count: attempt + 1,
      total: maxRetries + 1,
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
      subagentId,
    },
  } satisfies ModelRetryEvent);
}

export function emitCommentCriticStartEvent(
  runtime: Runtime,
  data: Omit<CommentCriticStartEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'comment_critic_start',
    data: { ...data, timestamp: Date.now() },
  } satisfies CommentCriticStartEvent);
}

export function emitCommentCriticEndEvent(
  runtime: Runtime,
  data: Omit<CommentCriticEndEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'comment_critic_end',
    data: { ...data, timestamp: Date.now() },
  } satisfies CommentCriticEndEvent);
}

export function emitReplyCriticStartEvent(
  runtime: Runtime,
  data: Omit<ReplyCriticStartEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'reply_critic_start',
    data: { ...data, timestamp: Date.now() },
  } satisfies ReplyCriticStartEvent);
}

export function emitReplyCriticEndEvent(
  runtime: Runtime,
  data: Omit<ReplyCriticEndEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'reply_critic_end',
    data: { ...data, timestamp: Date.now() },
  } satisfies ReplyCriticEndEvent);
}

export function emitCorrectiveNudgeStartEvent(
  runtime: Runtime,
  data: Omit<CorrectiveNudgeStartEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'corrective_nudge_start',
    data: { ...data, timestamp: Date.now() },
  } satisfies CorrectiveNudgeStartEvent);
}

export function emitCorrectiveNudgeEndEvent(
  runtime: Runtime,
  data: Omit<CorrectiveNudgeEndEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'corrective_nudge_end',
    data: { ...data, timestamp: Date.now() },
  } satisfies CorrectiveNudgeEndEvent);
}

// wrapToolCall short-circuits (no handler() call) skip on_tool_start/on_tool_end — emit these manually instead.
export function emitToolInputEvent(
  runtime: Runtime,
  data: Omit<ToolInputEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'tool_input',
    data: { ...data, timestamp: Date.now() },
  } satisfies ToolInputEvent);
}

export function emitToolOutputEvent(
  runtime: Runtime,
  data: Omit<ToolOutputEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'tool_output',
    data: { ...data, timestamp: Date.now() },
  } satisfies ToolOutputEvent);
}

export function emitMessageEvent(runtime: Runtime, data: MessageEvent['data']) {
  runtime.writer?.({ event: 'message', data } satisfies MessageEvent);
}

export function emitExtractProjectMemoryStartEvent(
  runtime: Runtime,
  data: Omit<ExtractProjectMemoryStartEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'extract_project_memory_start',
    data: { ...data, timestamp: Date.now() },
  } satisfies ExtractProjectMemoryStartEvent);
}

export function emitExtractProjectMemoryEndEvent(
  runtime: Runtime,
  data: Omit<ExtractProjectMemoryEndEvent['data'], 'timestamp'>,
) {
  runtime.writer?.({
    event: 'extract_project_memory_end',
    data: { ...data, timestamp: Date.now() },
  } satisfies ExtractProjectMemoryEndEvent);
}
