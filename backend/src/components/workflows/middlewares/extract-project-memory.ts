import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import { z } from 'zod';

import {
  type ExtractProjectMemoryEndEvent,
  type LLMProvider,
  MEMORY_CATEGORIES,
  type MemoryCandidate,
  type MemoryCategory,
} from '#types.js';

import { memoriesDal } from '#components/memories/dal.js';
import {
  emitCorrectiveNudgeEndEvent,
  emitCorrectiveNudgeStartEvent,
  emitExtractProjectMemoryEndEvent,
  emitExtractProjectMemoryStartEvent,
} from '#components/workflows/emit.js';
import { withBackendLimit } from '#components/workflows/middlewares/llm-backend-limiter.js';

import { retryWithBackoff, wasTruncatedByLength } from '#utils/helpers.js';
import { logger } from '#utils/logger.js';

// Bypasses modelRetryMiddleware (this is the curator's own internal LLM call, not the main agent's), so it needs its own retry protection.
const MAX_CURATOR_RETRIES = 2;

function buildCurationPrompt(
  curationGuidance: string,
  phrasingGuidance: string,
): string {
  return (
    `You have just completed a workflow in a repository.\n\n` +
    `Extract durable repository context that would improve future AI ` +
    `workflows operating on this same repository. Include only information ` +
    `that is likely to remain useful across future workflows.\n\n` +
    `${curationGuidance}\n\n` +
    `You are given <existing_memories> already stored across every category ` +
    `this run's candidates touched, and <candidates> the agent flagged during ` +
    `this run — each entry is labeled with its category. Compare each ` +
    `candidate against both <existing_memories> and the other <candidates> in ` +
    `this same batch, regardless of category — two candidates in this run can ` +
    `cover the same fact even under different self-assigned categories, and ` +
    `only one should become "add". For each candidate, decide one of:\n` +
    `- "add": genuinely new, not covered by an existing memory or by another ` +
    `candidate already decided in this batch. Requires title, content, and ` +
    `category — the candidate's self-assigned category is a suggestion, not ` +
    `final; pick whichever category (knowledge/preference/lesson/decision) ` +
    `actually fits best now that you can see the whole batch.\n` +
    `- "update": revises an existing memory — same topic, new or corrected ` +
    `content. Requires targetId and reason; include title/content/evidence only ` +
    `for the fields that changed.\n` +
    `- "retire": an existing memory is contradicted by this candidate, or ` +
    `confirmed to no longer apply. Requires targetId and reason.\n` +
    `- "skip": already covered by an existing memory or by another candidate ` +
    `in this batch, nothing to do. Requires candidateTitle and reason; include ` +
    `matchedId if an existing memory (rather than another candidate) is what ` +
    `already covers it.\n\n` +
    `Every decision must be traceable — "update"/"retire"/"skip" all require a ` +
    `short, specific reason (which existing memory or candidate it relates to ` +
    `and why), since these decisions are shown to a human reviewing what the ` +
    `curator did.\n\n` +
    `${phrasingGuidance}\n\n` +
    `Your decisions array must contain exactly one entry for every candidate — ` +
    `never omit one. If a candidate isn't worth acting on (duplicate, not ` +
    `durable, or already covered), emit an explicit "skip" for it; do not drop ` +
    `it by leaving it out. Return the decisions in candidate order.`
  );
}

const DecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    category: z
      .enum(MEMORY_CATEGORIES)
      .describe(
        "Which category this fact belongs to — reconsidered here with the whole batch visible, not just the candidate's self-assigned guess",
      ),
    title: z.string().describe('Short title for this fact'),
    content: z
      .string()
      .describe(
        "The fact itself, with enough detail to be useful without this run's context",
      ),
    evidence: z
      .array(z.string())
      .optional()
      .describe(
        'Direct quotes or references backing this up, e.g. a thread reply',
      ),
  }),
  z.object({
    action: z.literal('update'),
    targetId: z.string().describe('Existing entry id this decision revises'),
    title: z.string().optional().describe('New title, only if it changed'),
    content: z.string().optional().describe('New content, only if it changed'),
    evidence: z.array(z.string()).optional(),
    reason: z.string().describe('Why this existing memory needed revising'),
  }),
  z.object({
    action: z.literal('retire'),
    targetId: z.string().describe('Existing entry id to retire'),
    reason: z
      .string()
      .describe(
        'Why this existing memory is contradicted or no longer applies',
      ),
  }),
  z.object({
    action: z.literal('skip'),
    candidateTitle: z
      .string()
      .describe('Title of the flagged candidate this decision applies to'),
    matchedId: z
      .string()
      .optional()
      .describe(
        'Existing entry id already covering this candidate, if the skip is due to an existing memory rather than another candidate in this batch',
      ),
    reason: z
      .string()
      .describe('Why nothing needs to change for this candidate'),
  }),
]);

type Decision = z.infer<typeof DecisionSchema>;

type MemoryConfigurable = {
  projectId?: string;
  memoryCandidates?: MemoryCandidate[];
  memoryReflectNudged?: { nudged: boolean };
};

type MemoryRuntime = {
  configurable?: MemoryConfigurable;
};

// One curation call per run, across every category flagged — catches cross-category duplicates that per-category calls would miss.
export function extractProjectMemoryMiddleware({
  llm,
  provider,
  curationGuidance,
  phrasingGuidance,
  reflectPrompt,
}: {
  llm: BaseChatModel;
  provider: LLMProvider;
  curationGuidance: string;
  phrasingGuidance: string;
  reflectPrompt: string;
}) {
  const curationPrompt = buildCurationPrompt(
    curationGuidance,
    phrasingGuidance,
  );

  // Default structured-output method is silently ignored by Ollama models — force tool-calling.
  const curator = llm.withStructuredOutput(
    z.object({
      decisions: z.array(DecisionSchema),
    }),
    {
      method: 'functionCalling',
      includeRaw: true,
    },
  );

  // Suppress logger for expected/frequent errors
  function isExpectedCuratorError(err: unknown): boolean {
    return (
      err instanceof Error &&
      (err.message.includes('curator returned') ||
        err.message.includes('could not be parsed'))
    );
  }

  function buildCurationInput(
    existing: {
      id: string;
      category: MemoryCategory;
      title: string;
      content: string;
    }[],
    candidates: MemoryCandidate[],
  ): string {
    const existingBlock = existing.length
      ? existing
          .map(
            (entry) =>
              `- [${entry.category}] id=${entry.id} "${entry.title}": ${entry.content}`,
          )
          .join('\n')
      : '(none)';

    const candidatesBlock = candidates
      .map((candidate) => {
        const evidence = candidate.evidence.length
          ? ` (evidence: ${candidate.evidence.join('; ')})`
          : '';
        return `- [${candidate.category}] "${candidate.title}": ${candidate.content}${evidence}`;
      })
      .join('\n');

    return [
      '<existing_memories>',
      existingBlock,
      '</existing_memories>',
      '',
      '<candidates>',
      candidatesBlock,
      '</candidates>',
    ].join('\n');
  }

  // Known gap, not handled: update/retire act on a targetId from an <existing_memories> snapshot that can go stale if a concurrent run for the same project mutates it first.
  async function applyDecisions(
    projectId: string,
    decisions: Decision[],
    source: MemoryCandidate['source'],
  ): Promise<void> {
    for (const decision of decisions) {
      if (decision.action === 'skip') continue;

      if (decision.action === 'retire') {
        const deleted = await memoriesDal.deleteById(decision.targetId);

        if (!deleted) {
          logger.warn(
            { decision },
            'curator retire decision targetId not found — skipping',
          );
        }
        continue;
      }

      if (decision.action === 'update') {
        const updated = await memoriesDal.updateById(decision.targetId, {
          title: decision.title,
          content: decision.content,
          evidence: decision.evidence,
          source,
        });

        if (!updated) {
          logger.warn(
            { decision },
            'curator update decision targetId not found — skipping',
          );
        }

        continue;
      }

      // add
      await memoriesDal.insert({
        project_id: projectId,
        category: decision.category,
        title: decision.title,
        content: decision.content,
        evidence: decision.evidence ?? [],
        source,
      });
    }
  }

  function toEventDecision(
    decision: Decision,
  ): ExtractProjectMemoryEndEvent['data']['decisions'][number] {
    switch (decision.action) {
      case 'add':
        return {
          action: 'add',
          category: decision.category, // only add carries a category; others resolve it via targetId/matchedId
          title: decision.title,
          content: decision.content,
          evidence: decision.evidence,
        };
      case 'update':
        return {
          action: 'update',
          targetId: decision.targetId,
          title: decision.title,
          content: decision.content,
          evidence: decision.evidence,
          reason: decision.reason,
        };
      case 'retire':
        return {
          action: 'retire',
          targetId: decision.targetId,
          reason: decision.reason,
        };
      case 'skip':
        return {
          action: 'skip',
          candidateTitle: decision.candidateTitle,
          matchedId: decision.matchedId,
          reason: decision.reason,
        };
    }
  }

  return createMiddleware({
    name: 'ExtractProjectMemory',
    wrapModelCall: async (request, handler) => {
      const result = await handler(request);

      if (result.tool_calls?.length) return result;
      if (wasTruncatedByLength(result)) return result;

      const configurable = (request.runtime as MemoryRuntime).configurable;

      if (
        !configurable?.projectId ||
        !configurable.memoryCandidates ||
        configurable.memoryCandidates.length ||
        configurable.memoryReflectNudged?.nudged
      ) {
        return result;
      }

      configurable.memoryReflectNudged!.nudged = true;

      const id = crypto.randomUUID();
      emitCorrectiveNudgeStartEvent(request.runtime, {
        id,
        middleware: 'ExtractProjectMemory',
        prompt: reflectPrompt,
      });

      try {
        const rewritten = await handler({
          ...request,
          messages: [
            ...request.messages,
            result,
            new HumanMessage(reflectPrompt),
          ],
        });
        emitCorrectiveNudgeEndEvent(request.runtime, { id, error: '' });
        return rewritten;
      } catch (err) {
        // Best-effort — a review that already completed shouldn't fail
        // outright just because the reflect nudge itself hit an error.
        emitCorrectiveNudgeEndEvent(request.runtime, {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
        return result;
      }
    },
    afterAgent: async (_state, runtime) => {
      const configurable = (runtime as MemoryRuntime).configurable;
      const candidates = configurable?.memoryCandidates ?? [];

      if (!configurable?.projectId || !candidates.length) return;

      const projectId = configurable.projectId;
      // categories this run's candidates touched
      const touchedCategories = [
        ...new Set(candidates.map((candidate) => candidate.category)),
      ];

      const eventId = crypto.randomUUID();
      emitExtractProjectMemoryStartEvent(runtime, {
        id: eventId,
        categories: touchedCategories,
        prompt: curationPrompt,
      });

      // All categories, not just touchedCategories — category is only a guess, scoping the read to it hides real duplicates filed elsewhere.
      const existing = await memoriesDal.listByProject(projectId);

      let decisions: Decision[];
      let retries: number;
      // Kept outside the retry so an exhausted run can fall back to the last parse instead of dropping the valid decisions it did return.
      let lastParsed: Decision[] = [];

      try {
        const { result, attempt } = await retryWithBackoff(
          async () => {
            const { parsed } = await withBackendLimit(provider, runtime, () =>
              curator.invoke(
                [
                  ['system', curationPrompt],
                  ['human', buildCurationInput(existing, candidates)],
                ],
                // Tags this call so index.ts's message stream filter can exclude it — it's
                // an internal curation call, not a turn the user should see as a chat bubble.
                { metadata: { lc_source: 'extract_project_memory' } },
              ),
            );

            // includeRaw swaps a parse failure from a thrown error for a silent
            // `parsed: null` fallback — re-throw so retryWithBackoff treats it as
            // a failed attempt, same as before includeRaw was added.
            if (!parsed) {
              throw new Error(
                'curator response could not be parsed into the expected schema',
              );
            }

            lastParsed = parsed.decisions;

            // Fewer decisions than candidates means some were dropped (a dedup becomes a "skip", not a shorter array) — retry (a blind re-roll) for a full set. Not !==: one candidate can legitimately yield >1 decision (e.g. retire an old memory + add a new one).
            if (parsed.decisions.length < candidates.length) {
              throw new Error(
                `curator returned ${parsed.decisions.length} decisions for ${candidates.length} candidates`,
              );
            }

            return parsed.decisions;
          },
          {
            maxRetries: MAX_CURATOR_RETRIES,
            onAttemptFailed: (attempt, err) => {
              if (!isExpectedCuratorError(err)) {
                logger.error(
                  { err, categories: touchedCategories, attempt },
                  'extract project memory curation attempt failed',
                );
              }
            },
          },
        );

        decisions = result;
        retries = attempt;
      } catch (err) {
        // best-effort bookkeeping after an already-successful review — don't fail the run over it
        retries = MAX_CURATOR_RETRIES;
        // Apply whatever the last attempt parsed (may be short) rather than losing valid adds; empty only if nothing ever parsed. A short array is surfaced via missedCandidates below, not error.
        decisions = lastParsed;
        if (!isExpectedCuratorError(err)) {
          logger.error(
            { err, categories: touchedCategories, applied: decisions.length },
            'extract project memory failed after retries — applying last partial',
          );
        }
      }

      try {
        // Every candidate this run pushed carries the same fixed-per-run source (tools.ts) — first is as good as any.
        await applyDecisions(projectId, decisions, candidates[0].source);

        emitExtractProjectMemoryEndEvent(runtime, {
          id: eventId,
          decisions: decisions.map(toEventDecision),
          error: '',
          missed: Math.max(0, candidates.length - decisions.length),
          retries,
          maxRetries: MAX_CURATOR_RETRIES,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        emitExtractProjectMemoryEndEvent(runtime, {
          id: eventId,
          decisions: [],
          error: msg,
          // persist itself failed, so nothing landed — every candidate is unaccounted for
          missed: candidates.length,
          retries,
          maxRetries: MAX_CURATOR_RETRIES,
        });
      }
    },
  });
}
