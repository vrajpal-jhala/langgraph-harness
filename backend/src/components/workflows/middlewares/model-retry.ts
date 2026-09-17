import { createMiddleware } from 'langchain';

import { emitModelRetryEvents } from '#components/workflows/emit.js';

import { retryWithBackoff } from '#utils/helpers.js';

type ModelRetryRuntime = { configurable?: { subagentId?: string } };

// Some models occasionally emit malformed tool-call syntax mid model-call, crashing the run — retry a few times, reporting each attempt; still throws if every attempt fails, rather than faking a final answer.
export function modelRetryMiddleware(
  options: {
    maxRetries?: number;
  } = {},
) {
  const maxRetries = options.maxRetries ?? 3;

  return createMiddleware({
    name: 'ModelRetry',
    wrapModelCall: async (request, handler) => {
      // One id per invocation: wrapModelCall runs once per turn, covering all its retry attempts.
      const id = crypto.randomUUID();
      const subagentId = (request.runtime as ModelRetryRuntime).configurable
        ?.subagentId;
      const { result } = await retryWithBackoff(() => handler(request), {
        maxRetries,
        onAttemptFailed: (attempt, error) =>
          emitModelRetryEvents(request.runtime, {
            id,
            attempt,
            maxRetries,
            error,
            subagentId,
          }),
      });

      return result;
    },
  });
}
