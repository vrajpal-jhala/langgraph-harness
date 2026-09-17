import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import { messageContent } from '#utils/helpers.js';

// Char-based ceiling on any tool's raw output (same token-budget-proxy trade-off as `maxChars` in utils/config.ts), enforced as a backstop — tools should still aim to truncate well before this on their own.
export const MAX_TOOL_OUTPUT_CHARS = 40_000;

// Backstop for any tool's result, present or future — a single oversized result can outsize summarizeContextMiddleware's whole keep budget and push real prompt tokens toward the context ceiling, independent of that middleware's own trigger.
export function toolOutputCapMiddleware() {
  return createMiddleware({
    name: 'ToolOutputCap',
    wrapToolCall: async (request, handler) => {
      const result = await handler(request);

      if (!ToolMessage.isInstance(result)) return result;

      const content = messageContent(result.content);
      const maxChars = MAX_TOOL_OUTPUT_CHARS;

      if (content.length <= maxChars) return result;

      // Wrapped as a JSON string value rather than re-serialized in the original shape — JSON.stringify escapes whatever's inside it regardless of what got cut, so this is always valid JSON no matter where the cut lands.
      result.content = JSON.stringify({
        truncated: true,
        omittedChars: content.length - maxChars,
        note: 'This result exceeded the size limit and was truncated — treat it as incomplete; narrow your query/request rather than relying on this as the full result.',
        partial: content.slice(0, maxChars),
      });

      return result;
    },
  });
}
