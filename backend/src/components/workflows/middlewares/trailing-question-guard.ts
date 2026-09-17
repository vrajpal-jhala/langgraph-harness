import { HumanMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import {
  emitCorrectiveNudgeEndEvent,
  emitCorrectiveNudgeStartEvent,
} from '#components/workflows/emit.js';

import { messageContent, wasTruncatedByLength } from '#utils/helpers.js';

type GuardConfigurable = {
  trailingQuestionNudged?: { nudged: boolean };
  subagentId?: string;
};

type GuardRuntime = { configurable?: GuardConfigurable };

// Matches a message ending on a question mark, tolerating trailing markdown emphasis closers (**bold**, *italic*, __bold__, ~~strike~~) and whitespace — the system prompt's "never ask mid-task" rule doesn't obviously cover how a run should end, so the model occasionally closes an otherwise-complete task with a "**would you like me to...?**" menu anyway.
const TRAILING_QUESTION = /\?[*_~\s]*$/;

const CORRECTIVE_MESSAGE =
  "That reply ends with a question, but there's no one on the other end to " +
  "answer it. If the task isn't actually finished, don't wait for a " +
  'response — keep going and complete it using your best judgment. If it ' +
  'is finished, restate the reply as a factual summary of what you did, ' +
  'with no question, offer to do more, or next-step options at the end.';

// Backstop for the rare case where the model closes a completed run with a clarifying question anyway: asks it to restate as a completed summary rather than letting the halted-looking question reach the user unattended.
export function trailingQuestionGuardMiddleware() {
  return createMiddleware({
    name: 'TrailingQuestionGuard',
    wrapModelCall: async (request, handler) => {
      const result = await handler(request);

      if (result.tool_calls?.length) return result;
      if (wasTruncatedByLength(result)) return result;

      const content = messageContent(result.content);
      if (!TRAILING_QUESTION.test(content.trim())) return result;

      const configurable = (request.runtime as GuardRuntime).configurable;
      if (configurable?.trailingQuestionNudged?.nudged) return result;
      if (configurable) configurable.trailingQuestionNudged!.nudged = true;

      const subagentId = configurable?.subagentId;
      const id = crypto.randomUUID();
      emitCorrectiveNudgeStartEvent(request.runtime, {
        id,
        middleware: 'TrailingQuestionGuard',
        prompt: CORRECTIVE_MESSAGE,
        subagentId,
      });

      try {
        const rewritten = await handler({
          ...request,
          messages: [
            ...request.messages,
            result,
            new HumanMessage(CORRECTIVE_MESSAGE),
          ],
        });
        emitCorrectiveNudgeEndEvent(request.runtime, {
          id,
          error: '',
          subagentId,
        });
        return rewritten;
      } catch (err) {
        // Best-effort fix-up — a run that already completed shouldn't fail outright just because the corrective rewrite itself hit an error.
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
