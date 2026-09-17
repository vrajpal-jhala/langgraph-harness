import { randomUUID } from 'node:crypto';
import {
  AIMessage,
  type BaseMessage,
  getBufferString,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages';
import {
  type BuiltInState,
  type Runtime,
  summarizationMiddleware as langchainSummarizationMiddleware,
  type SummarizationMiddlewareConfig,
} from 'langchain';

import type { LLM } from '#types.js';

import {
  emitSummarizeContextEndEvent,
  emitSummarizeContextStartEvent,
} from '#components/workflows/emit.js';

import { config } from '#utils/config.js';
import { retryWithBackoff } from '#utils/helpers.js';
import { getTokenizer } from '#utils/tokenizer.js';

// Only the tool-call cache is read off the configurable — kept minimal so this
// middleware stays workflow-agnostic instead of importing a specific state type.
type SummarizeConfigurable = { toolCallCounts?: Map<string, number> };

// langchain's `keep` defaults to a message count (20), not tokens — single diff/changed-files results can be 20-70K tokens, so bound the tail by tokens instead.
const KEEP_TOKENS_FRACTION = 0.2;

// langchain's `trimTokensToSummarize` defaults to 4000, dropping most of the summarized segment (and erroring if even the tail doesn't fit) — widen it.
const TRIM_TOKENS_TO_SUMMARIZE_FRACTION = 0.5;

// Bypasses modelRetryMiddleware (this is the summarizer's own internal LLM call, not the main agent's), so it needs its own retry protection.
const MAX_SUMMARIZE_RETRIES = 3;

// Replaces LangChain's default prompt, which produced inconsistent summaries (raw tool_call dumps, stale error sections) — with explicit extraction rules.
const SUMMARY_PROMPT = `<role>
You are summarizing the working history of langgraph-harness, a GitLab-aware engineering assistant reviewing merge requests.
</role>

<context>
You're nearing the input token limit, so the conversation below will be replaced by the summary you write. Anything you omit is lost for the rest of the task — but this agent also has a separate mechanism that reinserts its most recent \`write_todos\` and \`load_skill\` calls, and the original query that started this task, verbatim after your summary. So don't spend space restating the todo list, which skill is loaded, or which MR/project is being reviewed — those already survive verbatim.
</context>

<instructions>
Extract only what a fresh reviewer picking up this task would need to continue without redoing work:
- The current version/commit being compared, if it has moved on since the original query.
- What has already been checked: files diffed, threads read, comments posted or resolved, approvals given.
- What remains to be done, and any conclusions reached so far (e.g. issues found, verdicts).

Do not:
- Include raw tool-call JSON, tool_call ids, or tool arguments — describe outcomes in plain prose instead.
- Carry forward tool errors that were already resolved or worked around; only mention an error if it is still unresolved and blocks progress.

Respond ONLY with the extracted summary. No preamble, no text before or after it.
</instructions>

<messages>
Messages to summarize:
{messages}
</messages>`;

export function summarizeContextMiddleware({
  llm,
  modelConfig,
  fraction,
  // Preserves only the most recent call per tool name (e.g. current todo list, not every write_todos ever made) — older calls summarize away normally, so this can't accumulate unboundedly.
  preserveLatestToolNames = [],
  // Constructor arg, not configurable: countTokens below is also handed to langchain's own tokenCounter, which never receives runtime. Shared with contextUsageMiddleware so messages aren't tokenized twice.
  messageTokenCache = new WeakMap<BaseMessage, number>(),
}: {
  llm: SummarizationMiddlewareConfig['model'];
  modelConfig: LLM;
  fraction: number;
  preserveLatestToolNames?: string[];
  messageTokenCache?: WeakMap<BaseMessage, number>;
}) {
  const triggerTokens =
    modelConfig.contextWindow *
    (fraction - config.summarization.triggerSafetyBuffer);
  const keepTokens = modelConfig.contextWindow * KEEP_TOKENS_FRACTION;
  const trimTokensToSummarize =
    modelConfig.contextWindow * TRIM_TOKENS_TO_SUMMARIZE_FRACTION;

  // Reused (cached) token counter for both langchain's trigger and our start-event pre-check.
  const countTokens = modelConfig.tokenizerRepo
    ? async (messages: BaseMessage[]) => {
        const resolvedTokenizer = await getTokenizer(
          modelConfig.tokenizerRepo!,
        );
        let total = 0;

        for (const message of messages) {
          let count = messageTokenCache.get(message);

          if (count === undefined) {
            count = resolvedTokenizer.encode(getBufferString([message])).length;
            messageTokenCache.set(message, count);
          }

          total += count;
        }

        return total;
      }
    : null;

  const middleware = langchainSummarizationMiddleware({
    model: llm,
    tokenCounter: countTokens ?? undefined,
    trigger: { tokens: triggerTokens },
    keep: { tokens: keepTokens },
    trimTokensToSummarize,
    summaryPrompt: SUMMARY_PROMPT,
  });

  // langchain's summarizationMiddleware emits nothing when it fires — it only signals via beforeModel's return value (undefined = no-op, defined = summarized).
  const beforeSummarizeContext = middleware.beforeModel as (
    state: BuiltInState,
    runtime: Runtime,
  ) => Promise<{ messages: BaseMessage[] } | undefined>;

  middleware.beforeModel = (async (state, runtime) => {
    const id = randomUUID();
    const timestamp = Date.now();
    // Only emit start when we're plausibly near the summarization threshold, to avoid a spurious event before every model call.
    const tokens = countTokens ? await countTokens(state.messages) : 0;

    if (tokens >= triggerTokens) {
      emitSummarizeContextStartEvent(runtime, {
        id,
        prompt: SUMMARY_PROMPT,
        timestamp,
      });
    }

    const { result, attempt } = await retryWithBackoff(
      () => beforeSummarizeContext(state, runtime),
      {
        maxRetries: MAX_SUMMARIZE_RETRIES,
        onAttemptFailed: (failedAttempt, err) => {
          const msg = err instanceof Error ? err.message : String(err);

          emitSummarizeContextEndEvent(runtime, {
            id,
            messagesBefore: state.messages.length,
            messagesAfter: state.messages.length,
            summary: '',
            error: `${failedAttempt === MAX_SUMMARIZE_RETRIES ? 'summarize context failed after retries: ' : ''}${msg}`,
            retries: failedAttempt,
            maxRetries: MAX_SUMMARIZE_RETRIES,
          });
        },
      },
    );

    if (result) {
      const cache = (runtime.configurable as SummarizeConfigurable)
        ?.toolCallCounts;
      const resultIds = new Set(result.messages.map((m) => m.id));

      // Latest dropped AIMessage per `preserveLatestToolNames` name — later occurrences overwrite earlier ones as we scan forward.
      const latestPreservedByName = new Map<string, AIMessage>();
      for (const msg of state.messages) {
        if (resultIds.has(msg.id) || !AIMessage.isInstance(msg)) continue;
        for (const tc of msg.tool_calls ?? []) {
          if (preserveLatestToolNames.includes(tc.name)) {
            latestPreservedByName.set(tc.name, msg);
          }
        }
      }

      const preservedAiIds = new Set(
        [...latestPreservedByName.values()].map((m) => m.id),
      );
      const preservedToolCallIds = new Set(
        [...latestPreservedByName.values()].flatMap((m) =>
          (m.tool_calls ?? []).map((tc) => tc.id).filter(Boolean),
        ),
      );

      const droppedPreserved: BaseMessage[] = [];

      // Preserve the latest-per-name pairs the cutoff dropped; clear the repeat count for every other dropped call (including superseded preserved-name calls).
      for (const msg of state.messages) {
        if (resultIds.has(msg.id)) continue; // kept by the cutoff already

        if (AIMessage.isInstance(msg)) {
          if (preservedAiIds.has(msg.id)) {
            droppedPreserved.push(msg);
          } else if (cache) {
            for (const tc of msg.tool_calls ?? []) {
              cache.delete(`${tc.name}|${JSON.stringify(tc.args ?? {})}`);
            }
          }
        } else if (
          ToolMessage.isInstance(msg) &&
          preservedToolCallIds.has(msg.tool_call_id)
        ) {
          droppedPreserved.push(msg);
        }
      }

      // Re-inserted after the summary since their original position is gone once that range is summarized.
      if (droppedPreserved.length) {
        result.messages.splice(2, 0, ...droppedPreserved);
      }

      // result.messages is [RemoveMessage(ALL), summaryMessage, ...preserved]
      const summaryMessage = result.messages[1];

      // Original query holds the project/MR ids with no other durable source — re-splice so it survives every future round too, not just this one.
      const firstHumanMessage = state.messages.find((m) =>
        HumanMessage.isInstance(m),
      );
      if (firstHumanMessage && !resultIds.has(firstHumanMessage.id)) {
        result.messages.splice(2, 0, firstHumanMessage);
      }

      emitSummarizeContextEndEvent(runtime, {
        id,
        messagesBefore: state.messages.length,
        messagesAfter: result.messages.length - 1,
        summary: summaryMessage.content as string,
        error: '',
        retries: attempt,
        maxRetries: MAX_SUMMARIZE_RETRIES,
      });
    }

    return result;
  }) as typeof middleware.beforeModel;

  return middleware;
}
