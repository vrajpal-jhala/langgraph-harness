import { createMiddleware, type Runtime } from 'langchain';
import pLimit, { type LimitFunction } from 'p-limit';

import type { LLM, LLMProvider } from '#types.js';

import {
  emitLlmBackendWaitEndEvent,
  emitLlmBackendWaitStartEvent,
} from '#components/workflows/emit.js';

import { config } from '#utils/config.js';

const limiters = new Map<LLMProvider, LimitFunction>(
  Object.entries(config.generation.provider).flatMap(([provider, settings]) =>
    'concurrency' in settings
      ? [[provider as LLMProvider, pLimit(settings.concurrency)]]
      : [],
  ),
);

export async function withBackendLimit<T>(
  provider: LLMProvider,
  runtime: Runtime | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const limiter = limiters.get(provider);

  if (!limiter) return fn();

  const subagentId = (runtime as { configurable?: { subagentId?: string } })
    ?.configurable?.subagentId;

  // Bracketed only when no permit is free, else every call emits two events for a zero wait.
  const waitId =
    limiter.activeCount >= limiter.concurrency || limiter.pendingCount
      ? crypto.randomUUID()
      : null;

  if (waitId && runtime) {
    emitLlmBackendWaitStartEvent(runtime, {
      id: waitId,
      provider,
      subagentId,
    });
  }

  return limiter(() => {
    if (waitId && runtime) {
      emitLlmBackendWaitEndEvent(runtime, { id: waitId, subagentId });
    }
    return fn();
  });
}

export function llmBackendLimiterMiddleware(modelConfig: LLM) {
  return createMiddleware({
    name: 'LlmBackendLimiter',
    wrapModelCall: (request, handler) =>
      withBackendLimit(modelConfig.provider, request.runtime, async () =>
        handler(request),
      ),
  });
}
