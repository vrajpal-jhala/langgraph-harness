import { HumanMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import {
  emitCorrectiveNudgeEndEvent,
  emitCorrectiveNudgeStartEvent,
} from '#components/workflows/emit.js';

import { wasTruncatedByLength } from '#utils/helpers.js';

type GuardConfigurable = {
  toolCallMade?: { called: boolean };
  noToolCallNudged?: { nudged: boolean };
  subagentId?: string;
};

type GuardRuntime = { configurable?: GuardConfigurable };

// Backstop for a run that finishes by only restating a previous turn's summary instead of verifying current state — catches a re-run that assumes an earlier pass still applies without checking anything.
export function noToolCallGuardMiddleware({ message }: { message: string }) {
  return createMiddleware({
    name: 'NoToolCallGuard',
    wrapToolCall: async (request, handler) => {
      const toolCallMade = (request.runtime as GuardRuntime).configurable
        ?.toolCallMade;
      if (toolCallMade) toolCallMade.called = true;

      return handler(request);
    },
    wrapModelCall: async (request, handler) => {
      const result = await handler(request);

      if (result.tool_calls?.length) return result;
      if (wasTruncatedByLength(result)) return result;

      const configurable = (request.runtime as GuardRuntime).configurable;
      if (configurable?.toolCallMade?.called) return result;
      if (configurable?.noToolCallNudged?.nudged) return result;

      configurable!.noToolCallNudged!.nudged = true;

      const subagentId = configurable?.subagentId;
      const id = crypto.randomUUID();
      emitCorrectiveNudgeStartEvent(request.runtime, {
        id,
        middleware: 'NoToolCallGuard',
        prompt: message,
        subagentId,
      });

      try {
        const rewritten = await handler({
          ...request,
          messages: [...request.messages, result, new HumanMessage(message)],
        });
        emitCorrectiveNudgeEndEvent(request.runtime, {
          id,
          error: '',
          subagentId,
        });
        return rewritten;
      } catch (err) {
        // Best-effort — a run that already concluded shouldn't fail outright just because the corrective rewrite itself hit an error.
        emitCorrectiveNudgeEndEvent(request.runtime, {
          id,
          error: err instanceof Error ? err.message : String(err),
          subagentId,
        });
        return result;
      }
    },
  });
}
