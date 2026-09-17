import { HumanMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import {
  emitCorrectiveNudgeEndEvent,
  emitCorrectiveNudgeStartEvent,
} from '#components/workflows/emit.js';
import type { SandboxAgentRuntime } from '#components/workflows/state.js';

import { mcpToolName, wasTruncatedByLength } from '#utils/helpers.js';

const LIST_ISSUE_DISCUSSIONS_TOOL = mcpToolName(
  'gitlab',
  'list_issue_discussions',
);
const MR_DISCUSSIONS_TOOL = mcpToolName('gitlab', 'mr_discussions');

// Backstop for a run that never checks for review/comment feedback before concluding — the system prompt asks for this up front, but a run resumed mid-review can miss a comment that lands after it's already underway, so this checks right before the run's last response instead of only at the start.
export function discussionCheckGuardMiddleware() {
  return createMiddleware({
    name: 'DiscussionCheckGuard',
    wrapToolCall: async (request, handler) => {
      const configurable = (request.runtime as SandboxAgentRuntime)
        .configurable;
      const requiredTool = configurable?.mrIid
        ? MR_DISCUSSIONS_TOOL
        : LIST_ISSUE_DISCUSSIONS_TOOL;

      if (
        request.toolCall.name === requiredTool &&
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

      const message = configurable?.mrIid
        ? `Before concluding, call \`${MR_DISCUSSIONS_TOOL}\` to check for any merge request feedback that arrived during this run — someone may have commented while you were working. Address anything unaddressed before finishing.`
        : `Before concluding, call \`${LIST_ISSUE_DISCUSSIONS_TOOL}\` to check for any issue comments that arrived during this run before finishing.`;

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
