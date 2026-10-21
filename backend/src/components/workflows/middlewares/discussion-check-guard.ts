import { HumanMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import {
  describeToolCall,
  describeToolCalls,
  discussionToolsFor,
  matchesToolCall,
} from '#components/workflows/discussion-tools.js';
import {
  emitCorrectiveNudgeEndEvent,
  emitCorrectiveNudgeStartEvent,
} from '#components/workflows/emit.js';
import type { SandboxAgentRuntime } from '#components/workflows/state.js';

import { wasTruncatedByLength } from '#utils/helpers.js';

// Backstop for a run that never checks for review/comment feedback before concluding — the system prompt asks for this up front, but a run resumed mid-review can miss a comment that lands after it's already underway, so this checks right before the run's last response instead of only at the start.
export function discussionCheckGuardMiddleware() {
  return createMiddleware({
    name: 'DiscussionCheckGuard',
    wrapToolCall: async (request, handler) => {
      const configurable = (request.runtime as SandboxAgentRuntime)
        .configurable;
      const tools = discussionToolsFor(configurable?.provider);
      const requiredCalls = configurable?.mrIid
        ? tools.mrFeedback
        : [tools.issueComments];

      if (
        requiredCalls.some((spec) => matchesToolCall(spec, request.toolCall)) &&
        configurable?.discussionCheckNudged
      ) {
        configurable.discussionCheckNudged.nudged = true;
      }

      return handler(request);
    },
    wrapModelCall: async (request, handler) => {
      const result = await handler(request);

      if (result.tool_calls?.length) return result;
      if (wasTruncatedByLength(result)) return result;

      const configurable = (request.runtime as SandboxAgentRuntime)
        .configurable;
      if (configurable?.discussionCheckNudged?.nudged) return result;

      const tools = discussionToolsFor(configurable?.provider);
      const message = configurable?.mrIid
        ? `Before concluding, call ${describeToolCalls(tools.mrFeedback)} to check for any feedback that arrived during this run — someone may have commented while you were working. Address anything unaddressed before finishing.`
        : `Before concluding, call ${describeToolCall(tools.issueComments)} to check for any issue comments that arrived during this run before finishing.`;

      if (configurable?.discussionCheckNudged) {
        configurable.discussionCheckNudged.nudged = true;
      }

      const id = crypto.randomUUID();
      emitCorrectiveNudgeStartEvent(request.runtime, {
        id,
        middleware: 'DiscussionCheckGuard',
        prompt: message,
      });

      try {
        const rewritten = await handler({
          ...request,
          messages: [...request.messages, result, new HumanMessage(message)],
        });
        emitCorrectiveNudgeEndEvent(request.runtime, { id, error: '' });
        return rewritten;
      } catch (err) {
        // Best-effort — a run that already concluded shouldn't fail outright just because the corrective rewrite itself hit an error.
        emitCorrectiveNudgeEndEvent(request.runtime, {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
        return result;
      }
    },
  });
}
