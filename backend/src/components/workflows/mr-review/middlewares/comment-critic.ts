import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import { z } from 'zod';

import { GitProvider, type LLMProvider } from '#types.js';

import {
  emitCommentCriticEndEvent,
  emitCommentCriticStartEvent,
} from '#components/workflows/emit.js';
import { withBackendLimit } from '#components/workflows/middlewares/llm-backend-limiter.js';
import type { WorkflowRuntime } from '#components/workflows/mr-review/state.js';

import {
  mcpToolName,
  messageContent,
  retryWithBackoff,
  toolErrorContent,
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

type ToolCall = { name: string; id?: string; args: Record<string, unknown> };

type Draft = { id: string; body: string };

type ReviewFlow = {
  // Lists comments left over from an earlier run, to screen them too.
  listDrafts?: string;
  createsDraft: (call: ToolCall) => boolean;
  draftIdFrom: (call: ToolCall, resultContent: string) => string | undefined;
  // undefined: not a publish; null: publishes every draft; a string: publishes only that draft.
  publishTarget: (call: ToolCall) => string | null | undefined;
  // A publish that carries its comments in its own args, so a dropped one is removed from them instead of withdrawn from the host.
  inlineDrafts?: (call: ToolCall) => Draft[] | undefined;
  withoutDrafts?: (
    args: Record<string, unknown>,
    droppedIds: Set<string>,
  ) => Record<string, unknown>;
  // The arg carrying a review-level summary, which Step 6 forbids — stripped deterministically.
  summaryArg: (call: ToolCall) => string | undefined;
};

const GITLAB_BULK_PUBLISH = mcpToolName(
  GitProvider.GitLab,
  'bulk_publish_draft_notes',
);
const GITLAB_SINGLE_PUBLISH = mcpToolName(
  GitProvider.GitLab,
  'publish_draft_note',
);
const GITHUB_SUBMIT_REVIEW = 'submit_review';

type InlineArgs = {
  comments?: { body?: string }[];
  replies?: { body?: string }[];
};

const REVIEW_FLOWS: Record<GitProvider, ReviewFlow> = {
  [GitProvider.GitLab]: {
    listDrafts: mcpToolName(GitProvider.GitLab, 'list_draft_notes'),
    createsDraft: (call) =>
      call.name === mcpToolName(GitProvider.GitLab, 'create_draft_note'),
    draftIdFrom: (_call, content) => {
      const { id } = JSON.parse(content) as { id?: string | number };
      return id == null ? undefined : String(id);
    },
    publishTarget: (call) =>
      call.name === GITLAB_BULK_PUBLISH
        ? null
        : call.name === GITLAB_SINGLE_PUBLISH
          ? String(call.args.draft_note_id)
          : undefined,
    summaryArg: (call) =>
      call.name === GITLAB_BULK_PUBLISH || call.name === GITLAB_SINGLE_PUBLISH
        ? 'note'
        : undefined,
  },
  [GitProvider.GitHub]: {
    createsDraft: () => false,
    draftIdFrom: () => undefined,
    publishTarget: () => undefined,
    inlineDrafts: (call) => {
      if (call.name !== GITHUB_SUBMIT_REVIEW) return undefined;
      const { comments = [], replies = [] } = call.args as InlineArgs;
      return [
        ...comments.map((c, i) => ({ id: `comment-${i}`, body: c.body ?? '' })),
        ...replies.map((r, i) => ({ id: `reply-${i}`, body: r.body ?? '' })),
      ];
    },
    withoutDrafts: (args, droppedIds) => {
      const { comments = [], replies = [] } = args as InlineArgs;
      return {
        ...args,
        comments: comments.filter((_, i) => !droppedIds.has(`comment-${i}`)),
        replies: replies.filter((_, i) => !droppedIds.has(`reply-${i}`)),
      };
    },
    // GitHub needs a body to request changes, where it's the one-line reason for withdrawing an approval.
    summaryArg: (call) =>
      call.name === GITHUB_SUBMIT_REVIEW &&
      call.args.event !== 'REQUEST_CHANGES'
        ? 'body'
        : undefined,
  },
};

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
  `style opinions. Also drop any comment that reads as unfinished or ` +
  `garbled — self-correction ("wait, that's the same"), repeated identical ` +
  `blocks, or text the author could not follow.`;

// Screens each not-yet-screened batch of drafts before publish, dropping anything a senior dev would roll their eyes at — lives in the tool-call path so it can't be skipped.
export function commentCriticMiddleware({
  llm,
  provider,
  gitProvider,
  withdrawDraft,
}: {
  llm: BaseChatModel;
  provider: LLMProvider;
  gitProvider: GitProvider;
  // Unneeded for a flow whose drafts are inline.
  withdrawDraft?: (draftId: string, runtime: WorkflowRuntime) => Promise<void>;
}) {
  const flow = REVIEW_FLOWS[gitProvider];
  // Default structured-output method is silently ignored by Ollama models — force tool-calling instead.
  const critic = llm.withStructuredOutput(VerdictSchema, {
    method: 'functionCalling',
    includeRaw: true,
  });

  return createMiddleware({
    name: 'CommentCritic',
    wrapToolCall: async (request, handler) => {
      const configurable = (request.runtime as WorkflowRuntime).configurable;

      const call = request.toolCall as ToolCall;

      if (flow.listDrafts && call.name === flow.listDrafts) {
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

      if (flow.createsDraft(call)) {
        const result = await handler(request);

        // A rejected draft (e.g. an invalid position) comes back as an error body, never a created draft.
        if (
          configurable?.draftNotes &&
          ToolMessage.isInstance(result) &&
          result.status !== 'error' &&
          !toolErrorContent(result)
        ) {
          try {
            const id = flow.draftIdFrom(call, messageContent(result.content));

            if (id == null) {
              throw new Error(`${call.name} response had no id`);
            }

            const { body } = (request.toolCall.args ?? {}) as {
              body?: string;
            };

            configurable.draftNotes.set(id, { id, body: body ?? '' });
          } catch (err) {
            // draft created but id is missing/unparseable — it'll publish without ever going through the critic
            logger.error(
              { err, tool: call.name },
              'draft created but its id was missing or unparseable — draft untracked by critic',
            );
          }
        }

        return result;
      }

      const summaryArg = flow.summaryArg(call);
      const publishTarget = flow.publishTarget(call);
      const inline = flow.inlineDrafts?.(call);

      if (summaryArg || publishTarget !== undefined || inline) {
        const summary = call.args[summaryArg ?? ''];
        const hasNote =
          typeof summary === 'string' && summary.trim().length > 0;

        const effectiveRequest = hasNote
          ? {
              ...request,
              toolCall: {
                ...request.toolCall,
                args: { ...request.toolCall.args, [summaryArg!]: undefined },
              },
            }
          : request;

        const strippedNoteNotice = hasNote
          ? `The \`${summaryArg}\` argument was not posted — a review never posts a ` +
            'general summary; only the individual comments were published.'
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

        if (
          !inline &&
          (publishTarget === undefined || !configurable?.draftNotes?.size)
        ) {
          return attachNote(
            await handler(effectiveRequest),
            strippedNoteNotice,
          );
        }

        const screenedIds = configurable?.commentCriticScreenedIds;
        const inlineVerdicts = configurable?.commentCriticInlineVerdicts;
        // A resubmit (e.g. after a rejected line) reuses each comment's earlier verdict, keyed by its text, instead of screening it again.
        const withheldBefore =
          inline?.filter((draft) => inlineVerdicts?.get(draft.body)) ?? [];
        // A single-draft publish only publishes the named draft, so only that one is screened
        const drafts = inline
          ? inline.filter((draft) => !inlineVerdicts?.has(draft.body))
          : [...(configurable?.draftNotes?.values() ?? [])].filter(
              (draft) =>
                !screenedIds?.has(draft.id) &&
                (publishTarget === null || draft.id === publishTarget),
            );

        const renderBucket = (
          items: { id: string; body: string }[],
          label: string,
        ) =>
          items.length
            ? `${label}\n${items.map((d) => `- ${d.body}`).join('\n')}`
            : '';

        const withheldNote = (items: { id: string; body: string }[]) =>
          renderBucket(
            items,
            `${items.length} draft comment(s) were withheld before ` +
              `publishing as non-actionable noise and were not posted:`,
          );

        const joinNotes = (...notes: string[]) =>
          notes.filter(Boolean).join('\n\n');

        const withoutDropped = (dropped: { id: string }[]) =>
          inline && dropped.length && flow.withoutDrafts
            ? {
                ...effectiveRequest,
                toolCall: {
                  ...effectiveRequest.toolCall,
                  args: flow.withoutDrafts(
                    effectiveRequest.toolCall.args,
                    new Set(dropped.map((d) => d.id)),
                  ),
                },
              }
            : effectiveRequest;

        if (!drafts.length) {
          // every currently-tracked draft has already been screened (first attempt succeeded, or this is a retry of the same batch) — publish as-is
          return attachNote(
            await handler(withoutDropped(withheldBefore)),
            joinNotes(withheldNote(withheldBefore), strippedNoteNotice),
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
            await handler(withoutDropped(withheldBefore)),
            joinNotes(withheldNote(withheldBefore), strippedNoteNotice),
          );
        } finally {
          // Marks the batch screened regardless of outcome — a later publish attempt must never re-invoke the critic on drafts already resolved.
          for (const draft of drafts)
            if (inline) inlineVerdicts?.set(draft.body, false);
            else screenedIds?.add(draft.id);
        }

        const dropped: { id: string; body: string }[] = [];
        const failed: { id: string; body: string }[] = [];
        const handled = new Set<string>();

        for (const verdict of verdicts) {
          const draft = drafts.find((d) => d.id === verdict.id);
          if (!verdict.drop || !draft || handled.has(verdict.id)) {
            continue;
          }
          handled.add(verdict.id);

          try {
            if (inline) inlineVerdicts?.set(draft.body, true);
            else
              await withdrawDraft?.(
                verdict.id,
                request.runtime as WorkflowRuntime,
              );
            dropped.push({ id: draft.id, body: draft.body });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            errors.push(`draft ${draft.id}: ${errMsg}`);
            // withdraw failed — draft is likely still live on the host, so don't report it as withheld
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

        const failedNote = renderBucket(
          failed,
          `${failed.length} draft comment(s) were flagged as ` +
            `non-actionable noise but could not be withdrawn due to an ` +
            `error, so they will still be published:`,
        );

        const allDropped = [...withheldBefore, ...dropped];
        const note = joinNotes(
          withheldNote(allDropped),
          failedNote,
          strippedNoteNotice,
        );
        const publishRequest = withoutDropped(allDropped);

        let result: Awaited<ReturnType<typeof handler>>;

        // this batch is now marked screened, so a retry skips straight to the base handler — this is the only chance to tell the model what got withheld/failed above.
        try {
          result = await handler(publishRequest);
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
