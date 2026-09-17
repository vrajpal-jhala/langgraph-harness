import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import { z } from 'zod';

import type { LLMProvider } from '#types.js';

import {
  emitReplyCriticEndEvent,
  emitReplyCriticStartEvent,
} from '#components/workflows/emit.js';
import { withBackendLimit } from '#components/workflows/middlewares/llm-backend-limiter.js';

import {
  mcpToolName,
  messageContent,
  retryWithBackoff,
} from '#utils/helpers.js';

const MAX_CRITIC_RETRIES = 2;

const CREATE_DISCUSSION_NOTE_TOOL = mcpToolName(
  'gitlab',
  'create_merge_request_discussion_note',
);

const VerdictSchema = z.object({
  drop: z
    .boolean()
    .describe('true if this reply should be withheld before posting'),
  reason: z.string().describe('One sentence explaining the verdict'),
});

const CRITIC_PROMPT =
  `You are a skeptical senior engineer screening a reply before it's posted ` +
  `publicly on a merge request. Drop it if it's non-actionable filler: bare ` +
  `acknowledgment ("noted", "working on it", "thanks for the feedback", ` +
  `"will look into this") with no actual content, a restatement of what the ` +
  `reviewer already said, or a vague promise with nothing concrete attached. ` +
  `Keep it if it tells the reader something they didn't already know: a ` +
  `concrete reason the feedback isn't being acted on, a specific decision or ` +
  `trade-off, or a substantive explanation.`;

// Screens every discussion-reply note before it posts — lives in the tool-call path so it can't be skipped.
export function replyCriticMiddleware({
  llm,
  provider,
}: {
  llm: BaseChatModel;
  provider: LLMProvider;
}) {
  // Default structured-output method is silently ignored by Ollama models — force tool-calling instead.
  const critic = llm.withStructuredOutput(VerdictSchema, {
    method: 'functionCalling',
    includeRaw: true,
  });

  return createMiddleware({
    name: 'ReplyCritic',
    wrapToolCall: async (request, handler) => {
      if (request.toolCall.name !== CREATE_DISCUSSION_NOTE_TOOL) {
        return handler(request);
      }

      const { body } = (request.toolCall.args ?? {}) as { body?: string };
      if (!body) return handler(request);

      const eventId = crypto.randomUUID();
      emitReplyCriticStartEvent(request.runtime, {
        id: eventId,
        prompt: CRITIC_PROMPT,
      });

      let verdict: { drop: boolean; reason: string };
      let content: string;
      let retries: number;
      const attemptErrors: string[] = [];

      try {
        const { result, attempt } = await retryWithBackoff(
          async () => {
            const { raw, parsed } = await withBackendLimit(
              provider,
              request.runtime,
              () =>
                critic.invoke(
                  [
                    ['system', CRITIC_PROMPT],
                    ['human', body],
                  ],
                  // Tags this call so index.ts's message stream filter excludes it — an internal verdict call, not a user-facing turn.
                  { metadata: { lc_source: 'reply_critic' } },
                ),
            );

            // includeRaw turns a parse failure into a silent `parsed: null` — re-throw so retryWithBackoff treats it as a failed attempt.
            if (!parsed) {
              throw new Error(
                'critic response could not be parsed into the expected verdict schema',
              );
            }

            return { verdict: parsed, content: messageContent(raw.content) };
          },
          {
            maxRetries: MAX_CRITIC_RETRIES,
            onAttemptFailed: (failedAttempt, err) => {
              const msg = err instanceof Error ? err.message : String(err);
              attemptErrors.push(`attempt ${failedAttempt}: ${msg}`);
            },
          },
        );

        verdict = result.verdict;
        content = result.content;
        retries = attempt;
      } catch {
        emitReplyCriticEndEvent(request.runtime, {
          id: eventId,
          content: '',
          verdicts: [],
          dropped: [],
          failed: [],
          error: attemptErrors.join('; '),
          retries: MAX_CRITIC_RETRIES,
          maxRetries: MAX_CRITIC_RETRIES,
        });

        return handler(request);
      }

      emitReplyCriticEndEvent(request.runtime, {
        id: eventId,
        content,
        verdicts: [{ id: '0', drop: verdict.drop }],
        dropped: verdict.drop ? [{ id: '0', body }] : [],
        failed: [],
        error: attemptErrors.join('; '),
        retries,
        maxRetries: MAX_CRITIC_RETRIES,
      });

      if (!verdict.drop) return handler(request);

      // Never a bare tool failure — tell the model exactly why so it can revise or drop the attempt.
      return new ToolMessage({
        content: JSON.stringify({ posted: false, reason: verdict.reason }),
        tool_call_id: request.toolCall.id ?? '',
      });
    },
  });
}
