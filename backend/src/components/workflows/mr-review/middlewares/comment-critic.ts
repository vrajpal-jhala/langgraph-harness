import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ToolMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { createMiddleware } from 'langchain';
import { z } from 'zod';

import type { LLMProvider } from '#types.js';

import {
  emitCommentCriticEndEvent,
  emitCommentCriticStartEvent,
} from '#components/workflows/emit.js';
import { withBackendLimit } from '#components/workflows/middlewares/llm-backend-limiter.js';
import type { WorkflowRuntime } from '#components/workflows/mr-review/state.js';

import { config } from '#utils/config.js';
import {
  mcpToolName,
  messageContent,
  retryWithBackoff,
} from '#utils/helpers.js';
import { logger } from '#utils/logger.js';

// Bypasses modelRetryMiddleware (this is the critic's own LLM call, not the main agent's) — needs its own retry protection.
const MAX_CRITIC_RETRIES = 2;

const VerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.string().describe('The draft comment id being judged'),
      drop: z
        .boolean()
        .describe('true if this comment should be dropped before publishing'),
    }),
  ),
});

const CRITIC_PROMPT =
  `You are a skeptical senior engineer screening draft code review comments ` +
  `before they're posted publicly. For each comment below, decide whether to ` +
  `drop it. Drop anything a senior dev would roll their eyes at: hedged ` +
  `non-issues ("worth noting", "likely fine, but"), comments that just ` +
  `restate what the diff already shows, speculative edge cases with no ` +
  `evidence, or style opinions dressed up as bugs. Also drop bare ` +
  `"still not addressed" / "remains unchanged" reposts of a previously-flagged ` +
  `issue that don't describe anything new about the latest fix attempt — the ` +
  `open thread already says "not resolved", so repeating that every round is ` +
  `spam, not review, even when the underlying concern is real. But if the ` +
  `comment reports on the specific latest fix attempt — e.g. the author ` +
  `partially addressed it, changed the approach, or the symptom shifted — ` +
  `keep it even though the underlying issue traces back to an earlier round; ` +
  `that's new information, not a repost. Keep only comments that point to a ` +
  `concrete, actionable problem the author should fix and that tell the ` +
  `author something they don't already know. Scope/hygiene problems — an ` +
  `unrelated file or commit mixed into this MR, changes outside the stated ` +
  `purpose — are concrete and actionable; keep them, don't treat them as ` +
  `style opinions.`;

// Screens each not-yet-screened batch of drafts before publish, dropping anything a senior dev would roll their eyes at — lives in the tool-call path so it can't be skipped.
export function commentCriticMiddleware({
  llm,
  provider,
  deleteDraftNoteTool,
}: {
  llm: BaseChatModel;
  provider: LLMProvider;
  deleteDraftNoteTool?: DynamicStructuredTool;
}) {
  // Default structured-output method is silently ignored by Ollama models — force tool-calling instead.
  const critic = llm.withStructuredOutput(VerdictSchema, {
    method: 'functionCalling',
    includeRaw: true,
  });

  return createMiddleware({
    name: 'CommentCritic',
    wrapToolCall: async (request, handler) => {
      const configurable = (request.runtime as WorkflowRuntime).configurable;
      const signal = (request.runtime as WorkflowRuntime).signal;

      if (request.toolCall.name === mcpToolName('gitlab', 'list_draft_notes')) {
        const result = await handler(request);

        // Surfaces pre-existing drafts (e.g. left over from an earlier run) into the tracking Map — piggybacks on the model's own mandated first list_draft_notes call instead of listing again.
        if (configurable?.draftNotes && ToolMessage.isInstance(result)) {
          try {
            const drafts = JSON.parse(messageContent(result.content)) as Array<{
              id: string | number;
              note?: string;
              body?: string;
            }>;

            for (const draft of drafts) {
              const key = String(draft.id);
              if (!configurable.draftNotes.has(key)) {
                configurable.draftNotes.set(key, {
                  id: key,
                  body: draft.note ?? draft.body ?? '',
                });
              }
            }
          } catch {
            // listing result unparseable — proceed without the inherited drafts
          }
        }

        return result;
      }

      if (
        request.toolCall.name === mcpToolName('gitlab', 'create_draft_note')
      ) {
        const result = await handler(request);

        if (configurable?.draftNotes && ToolMessage.isInstance(result)) {
          try {
            const { id } = JSON.parse(messageContent(result.content)) as {
              id?: string | number;
            };

            if (id == null) {
              throw new Error('create_draft_note response had no id');
            }

            const { body } = (request.toolCall.args ?? {}) as {
              body?: string;
            };

            configurable.draftNotes.set(String(id), {
              id: String(id),
              body: body ?? '',
            });
          } catch (err) {
            // draft created but id is missing/unparseable — it'll publish without ever going through the critic
            logger.error(
              { err },
              'create_draft_note succeeded but id was missing or unparseable — draft untracked by critic',
            );
          }
        }

        return result;
      }

      if (
        request.toolCall.name ===
        mcpToolName('gitlab', 'bulk_publish_draft_notes')
      ) {
        // note is always a general MR-level overview, which Step 6 already forbids outright — strip it deterministically, no critic call needed.
        const { note: noteArg } = (request.toolCall.args ?? {}) as {
          note?: string;
        };
        const hasNote =
          typeof noteArg === 'string' && noteArg.trim().length > 0;

        const effectiveRequest = hasNote
          ? {
              ...request,
              toolCall: {
                ...request.toolCall,
                args: { ...request.toolCall.args, note: undefined },
              },
            }
          : request;

        const strippedNoteNotice = hasNote
          ? 'The `note` argument was not posted — bulk_publish_draft_notes never posts a ' +
            'general MR-level summary; only the individual draft comments were published.'
          : '';

        const attachNote = (
          result: Awaited<ReturnType<typeof handler>>,
          extraNote: string,
        ) => {
          if (!extraNote || !ToolMessage.isInstance(result)) return result;

          const raw = messageContent(result.content);
          let payload: unknown;

          try {
            payload = JSON.parse(raw);
          } catch {
            payload = raw;
          }

          result.content = JSON.stringify(
            payload && typeof payload === 'object' && !Array.isArray(payload)
              ? { ...payload, note: extraNote }
              : { result: payload, note: extraNote },
          );

          return result;
        };

        if (!deleteDraftNoteTool || !configurable?.draftNotes?.size) {
          return attachNote(
            await handler(effectiveRequest),
            strippedNoteNotice,
          );
        }

        const screenedIds = configurable.commentCriticScreenedIds;
        const drafts = [...configurable.draftNotes.values()].filter(
          (draft) => !screenedIds?.has(draft.id),
        );

        if (!drafts.length) {
          // every currently-tracked draft has already been screened (first attempt succeeded, or this is a retry of the same batch) — publish as-is
          return attachNote(
            await handler(effectiveRequest),
            strippedNoteNotice,
          );
        }

        const project_id = configurable.projectId;
        const merge_request_iid = configurable.mrIid;

        if (!project_id || !merge_request_iid) {
          logger.error(
            { projectId: project_id, mrIid: merge_request_iid },
            'commentCriticMiddleware missing projectId/mrIid in configurable — skipping critic',
          );

          return attachNote(
            await handler(effectiveRequest),
            strippedNoteNotice,
          );
        }

        const eventId = crypto.randomUUID();

        emitCommentCriticStartEvent(request.runtime, {
          id: eventId,
          prompt: CRITIC_PROMPT,
        });

        let verdicts: { id: string; drop: boolean }[];
        let content: string;
        let retries: number;
        const errors: string[] = [];

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
                      ['human', JSON.stringify(drafts)],
                    ],
                    // Tags this call so index.ts's message stream filter excludes it — an internal verdict call, not a user-facing turn.
                    { metadata: { lc_source: 'comment_critic' } },
                  ),
              );

              // includeRaw turns a parse failure into a silent `parsed: null` — re-throw so retryWithBackoff treats it as a failed attempt.
              if (!parsed) {
                throw new Error(
                  'critic response could not be parsed into the expected verdict schema',
                );
              }

              return {
                verdicts: parsed.verdicts,
                content: messageContent(raw.content),
              };
            },
            {
              maxRetries: MAX_CRITIC_RETRIES,
              onAttemptFailed: (failedAttempt, err) => {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`attempt ${failedAttempt}: ${msg}`);
              },
            },
          );

          ({ verdicts, content } = result);
          retries = attempt;
        } catch {
          emitCommentCriticEndEvent(request.runtime, {
            id: eventId,
            content: '',
            verdicts: [],
            dropped: [],
            failed: [],
            error: errors.join('; '),
            retries: MAX_CRITIC_RETRIES,
            maxRetries: MAX_CRITIC_RETRIES,
          });

          return attachNote(
            await handler(effectiveRequest),
            strippedNoteNotice,
          );
        } finally {
          // Marks the batch screened regardless of outcome — a later publish attempt must never re-invoke the critic on drafts already resolved.
          for (const draft of drafts) {
            configurable.commentCriticScreenedIds?.add(draft.id);
          }
        }

        const dropped: { id: string; body: string }[] = [];
        const failed: { id: string; body: string }[] = [];
        const handled = new Set<string>();

        for (const verdict of verdicts) {
          const draft = configurable.draftNotes.get(verdict.id);
          if (!verdict.drop || !draft || handled.has(verdict.id)) {
            continue;
          }
          handled.add(verdict.id);

          try {
            if (!config.mock.workflow) {
              // ToolCall shape (not a bare args object) so LangChain attaches an id to the resulting tool_input/tool_output events
              await deleteDraftNoteTool.invoke(
                {
                  type: 'tool_call',
                  name: deleteDraftNoteTool.name,
                  id: crypto.randomUUID(),
                  args: {
                    project_id,
                    merge_request_iid,
                    draft_note_id: verdict.id,
                  },
                },
                { signal },
              );
            }
            dropped.push({ id: draft.id, body: draft.body });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            errors.push(`draft ${draft.id}: ${errMsg}`);
            // delete failed — draft is likely still live on GitLab, so don't report it as withheld
            failed.push({ id: draft.id, body: draft.body });
          }
        }

        emitCommentCriticEndEvent(request.runtime, {
          id: eventId,
          content,
          verdicts,
          dropped,
          failed,
          error: errors.join('; '),
          retries,
          maxRetries: MAX_CRITIC_RETRIES,
        });

        const renderBucket = (
          items: { id: string; body: string }[],
          label: string,
        ) =>
          items.length
            ? `${label}\n${items.map((d) => `- ${d.body}`).join('\n')}`
            : '';

        const withheldNote = renderBucket(
          dropped,
          `${dropped.length} draft comment(s) were withheld before ` +
            `publishing as non-actionable noise and were not posted:`,
        );

        const failedNote = renderBucket(
          failed,
          `${failed.length} draft comment(s) were flagged as ` +
            `non-actionable noise but could not be withdrawn due to an ` +
            `error, so they will still be published:`,
        );

        const note = [withheldNote, failedNote, strippedNoteNotice]
          .filter(Boolean)
          .join('\n\n');

        let result: Awaited<ReturnType<typeof handler>>;

        // this batch is now marked screened, so a retry skips straight to the base handler — this is the only chance to tell the model what got withheld/failed above.
        try {
          result = await handler(effectiveRequest);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new ToolMessage({
            content: JSON.stringify({
              error: msg,
              ...(note ? { note } : {}),
            }),
            tool_call_id: request.toolCall.id ?? '',
          });
        }

        // Tell the model what got withheld/failed — it has no other way to know, since deletion happens silently above.
        return attachNote(result, note);
      }

      return handler(request);
    },
  });
}
