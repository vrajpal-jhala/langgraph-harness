import { tool, type ToolRuntime } from '@langchain/core/tools';

import type { MemoryCandidate, MemorySource } from '#types.js';

import { MemoryCandidateSchema } from './candidate.js';

import { logger } from '#utils/logger.js';

const createMemoryCandidateSchema = MemoryCandidateSchema.omit({
  source: true,
});

type MemoryToolConfigurable = { memoryCandidates?: MemoryCandidate[] };

// Shared by every workflow that curates project memories — pushing a
// candidate onto `configurable.memoryCandidates` is identical everywhere;
// only the resulting `source` (which workflow/entity it came from) and the
// tool's own description differ per caller.
export function createMemoryCandidateTool<
  TConfigurable extends MemoryToolConfigurable,
>(options: {
  description: string;
  buildSource: (configurable: TConfigurable) => MemorySource;
}) {
  return tool(
    async (candidate, runtime: ToolRuntime<unknown, unknown>) => {
      const { category, title, content, evidence } = candidate;
      const configurable = runtime.configurable as
        Partial<TConfigurable> | undefined;

      if (!configurable?.memoryCandidates) {
        logger.warn(
          { category, title },
          'create_memory_candidate called without memoryCandidates tracking on this run — dropping it',
        );

        return { error: 'memory candidates are not tracked for this run' };
      }

      configurable.memoryCandidates.push({
        category,
        title,
        content,
        evidence,
        source: options.buildSource(configurable as TConfigurable),
      });

      return { recorded: true };
    },
    {
      name: 'create_memory_candidate',
      description: options.description,
      schema: createMemoryCandidateSchema,
    },
  );
}
