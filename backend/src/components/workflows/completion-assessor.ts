import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';

import { CompletionStatus, type ModelName } from '#types.js';

import { withBackendLimit } from '#components/workflows/middlewares/llm-backend-limiter.js';

import { llms } from '#utils/config.js';
import { retryWithBackoff } from '#utils/helpers.js';
import { buildChatModel } from '#utils/llm.js';

const CompletionSchema = z.object({
  status: z.enum(CompletionStatus),
  summary: z
    .string()
    .describe(
      '1-3 sentence plain-English summary of what was done and, if not fully done, what remains or what blocked it',
    ),
});

const MAX_ASSESS_RETRIES = 2;

function buildCompletionPrompt(repoInstructions: string) {
  return [
    `Classify how a coding agent's just-finished run actually went, from its ` +
      `own conversation above.\n\n` +
      `- "done": the task was fully completed and verified (build/lint/tests ` +
      `run and passing, as applicable).\n` +
      `- "partial": real progress was made, but something is left unfinished ` +
      `or unverified.\n` +
      `- "blocked": little or no progress — missing information, an external ` +
      `dependency, or a limitation stopped it early.\n\n` +
      `Base this only on what the conversation actually shows happened, not on ` +
      `how confident the agent's own closing remarks sound.`,
    ...(repoInstructions
      ? [
          `The repository owner defined what counts as done here — weigh it when deciding "done" vs "partial":\n${repoInstructions}`,
        ]
      : []),
  ].join('\n\n');
}

export async function assessCompletion(params: {
  messages: BaseMessage[];
  model: ModelName;
  repoInstructions: string;
}) {
  const modelConfig = llms.find((m) => m.model === params.model);
  if (!modelConfig) throw new Error(`Unknown model: ${params.model}`);

  const classifier = buildChatModel(modelConfig, false).withStructuredOutput(
    CompletionSchema,
    { method: 'functionCalling', includeRaw: true },
  );

  const prompt = buildCompletionPrompt(params.repoInstructions);

  const { result, attempt } = await retryWithBackoff(
    async () => {
      const { parsed } = await withBackendLimit(
        modelConfig.provider,
        undefined,
        () => classifier.invoke([...params.messages, ['human', prompt]]),
      );

      if (!parsed) {
        throw new Error('completion classifier response could not be parsed');
      }

      return parsed;
    },
    { maxRetries: MAX_ASSESS_RETRIES },
  );

  return {
    status: result.status,
    summary: result.summary,
    retries: attempt,
    maxRetries: MAX_ASSESS_RETRIES,
  };
}
