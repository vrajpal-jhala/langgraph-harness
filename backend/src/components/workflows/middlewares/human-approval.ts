import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import {
  emitCorrectiveNudgeEndEvent,
  emitCorrectiveNudgeStartEvent,
  emitInterruptEvent,
} from '#components/workflows/emit.js';

// Uses jumpTo:'end' instead of LangGraph's interrupt(), which needs a checkpointer this
// per-turn agent doesn't have; chatWorkflow.stream()'s decision branch handles resuming.
export function humanApprovalMiddleware({
  needsApproval,
}: {
  needsApproval: (toolCall: { name: string }) => boolean;
}) {
  return createMiddleware({
    name: 'HumanApproval',
    // afterModel can only hold one call at a time, so nudge a mixed batch apart before it gets there.
    wrapModelCall: async (request, handler) => {
      const result = await handler(request);
      const calls = result.tool_calls ?? [];
      const pending = calls.filter(needsApproval);

      if (calls.length <= 1 || !pending.length) return result;

      const id = crypto.randomUUID();
      const names = pending.map((tc) => `\`${tc.name}\``).join(', ');
      const prompt =
        `You requested ${calls.length} tool calls in this turn, but ${names} ` +
        `require${pending.length > 1 ? '' : 's'} human approval and can't be batched ` +
        `with other calls. Call only one of them by itself this turn — the rest can ` +
        `be requested again after it's resolved.`;

      emitCorrectiveNudgeStartEvent(request.runtime, {
        id,
        middleware: 'HumanApproval',
        prompt,
      });

      try {
        const rewritten = await handler({
          ...request,
          messages: [...request.messages, result, new HumanMessage(prompt)],
        });
        const stillPending = (rewritten.tool_calls ?? []).filter(needsApproval);
        if ((rewritten.tool_calls?.length ?? 0) > 1 && stillPending.length) {
          throw new Error(
            `Model still batched ${stillPending.map((tc) => `\`${tc.name}\``).join(', ')} with other tool calls after being asked to isolate it.`,
          );
        }
        emitCorrectiveNudgeEndEvent(request.runtime, { id, error: '' });
        return rewritten;
      } catch (err) {
        // Nothing downstream catches a dropped batch — fail loudly instead.
        emitCorrectiveNudgeEndEvent(request.runtime, {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    afterModel: {
      // Undeclared jumpTo targets throw at runtime, so 'end' must be listed here.
      canJumpTo: ['end'],
      hook: (state, runtime) => {
        const last = state.messages[state.messages.length - 1];
        if (!last || !AIMessage.isInstance(last) || !last.tool_calls?.length) {
          return;
        }

        // wrapModelCall above guarantees at most one pending call ever reaches here.
        const pending = last.tool_calls.find((tc) => needsApproval(tc));
        if (!pending?.id) return;

        emitInterruptEvent(runtime, {
          id: crypto.randomUUID(),
          toolCallId: pending.id,
          name: pending.name,
          args: pending.args,
        });

        return { jumpTo: 'end' };
      },
    },
  });
}
