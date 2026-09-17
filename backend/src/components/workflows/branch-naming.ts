import { z } from 'zod';

import type { ModelName, RunEvent } from '#types.js';
import { RunStep } from '#types.js';

import { withBackendLimit } from '#components/workflows/middlewares/llm-backend-limiter.js';

import { llms } from '#utils/config.js';
import { retryWithBackoff } from '#utils/helpers.js';
import { buildChatModel } from '#utils/llm.js';

export const BRANCH_TYPES = [
  'feat',
  'fix',
  'chore',
  'refactor',
  'docs',
  'style',
  'perf',
  'test',
] as const;

const ClassificationSchema = z.object({
  type: z.enum(BRANCH_TYPES),
  slug: z
    .string()
    .describe('2-4 word kebab-case summary of the work, e.g. "add-dark-mode"'),
});

const MAX_CLASSIFY_RETRIES = 2;

const CLASSIFY_PROMPT =
  `Classify a unit of work into a Conventional-Commits-style branch type and a ` +
  `short slug, for naming a branch as \`harness/<type>/<id>-<slug>\`.\n\n` +
  `Allowed types: feat (new feature/capability), fix (bug fix), chore ` +
  `(routine maintenance/deps/tooling), refactor (internal restructuring, no ` +
  `behavior change), docs (documentation only), style (formatting only, no ` +
  `logic change), perf (performance improvement), test (test-only changes).\n\n` +
  `If a \`type::*\` label is supplied, treat it as a hint, not an answer — ` +
  `"type::task" has no direct mapping onto the list above, so always classify ` +
  `from the actual title/description content, never the label alone.`;

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function parseBranchType(
  branchName: string,
): (typeof BRANCH_TYPES)[number] | undefined {
  const [, type] = branchName.split('/');
  return (BRANCH_TYPES as readonly string[]).includes(type)
    ? (type as (typeof BRANCH_TYPES)[number])
    : undefined;
}

export async function* classifyBranch(params: {
  title: string;
  description: string;
  labelHint?: string;
  model: ModelName;
}): AsyncGenerator<
  RunEvent,
  { type: (typeof BRANCH_TYPES)[number]; slug: string }
> {
  const modelConfig = llms.find((m) => m.model === params.model);
  if (!modelConfig) throw new Error(`Unknown model: ${params.model}`);

  const classifier = buildChatModel(modelConfig, false).withStructuredOutput(
    ClassificationSchema,
    { method: 'functionCalling', includeRaw: true },
  );

  const id = crypto.randomUUID();
  yield {
    event: 'run_step_start',
    data: {
      id,
      step: RunStep.ClassifyIssue,
      prompt: CLASSIFY_PROMPT,
      timestamp: Date.now(),
    },
  };

  const { title, description, labelHint } = params;

  try {
    const { result, attempt } = await retryWithBackoff(
      async () => {
        const { parsed } = await withBackendLimit(
          modelConfig.provider,
          undefined,
          () =>
            classifier.invoke([
              ['system', CLASSIFY_PROMPT],
              ['human', JSON.stringify({ title, description, labelHint })],
            ]),
        );

        if (!parsed) {
          throw new Error('branch classifier response could not be parsed');
        }

        return parsed;
      },
      { maxRetries: MAX_CLASSIFY_RETRIES },
    );

    yield {
      event: 'run_step_end',
      data: {
        id,
        step: RunStep.ClassifyIssue,
        type: result.type,
        slug: result.slug,
        error: '',
        retries: attempt,
        maxRetries: MAX_CLASSIFY_RETRIES,
        timestamp: Date.now(),
      },
    };

    return result;
  } catch (err) {
    yield {
      event: 'run_step_end',
      data: {
        id,
        step: RunStep.ClassifyIssue,
        type: '',
        slug: '',
        error: err instanceof Error ? err.message : String(err),
        retries: MAX_CLASSIFY_RETRIES,
        maxRetries: MAX_CLASSIFY_RETRIES,
        timestamp: Date.now(),
      },
    };
    throw err;
  }
}
