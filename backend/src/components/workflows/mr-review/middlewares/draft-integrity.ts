import { ToolMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { createMiddleware } from 'langchain';

import { gitService } from '#components/repositories/service.js';
import {
  emitToolInputEvent,
  emitToolOutputEvent,
} from '#components/workflows/emit.js';
import type {
  DraftPosition,
  WorkflowConfigurable,
  WorkflowRuntime,
} from '#components/workflows/mr-review/state.js';

import { config } from '#utils/config.js';
import { parseDiffLineMap, validatePosition } from '#utils/diff.js';
import { mcpToolName, messageContent } from '#utils/helpers.js';
import { logger } from '#utils/logger.js';

type PositionArgs = {
  new_path?: string;
  old_line?: number | null;
  new_line?: number | null;
  base_sha?: string;
  head_sha?: string;
  start_sha?: string;
};

type CreateDraftNoteArgs = {
  project_id?: string;
  merge_request_iid?: string;
  body?: string;
  position?: PositionArgs;
};

async function fetchDiffLineMap(
  getFileDiffTool: DynamicStructuredTool,
  args: { project_id: string; merge_request_iid: string; new_path: string },
  signal?: AbortSignal,
) {
  // ToolCall shape (not a bare args object) so LangChain attaches an id to the resulting tool_input/tool_output events
  const result = await getFileDiffTool.invoke(
    {
      type: 'tool_call',
      name: getFileDiffTool.name,
      id: crypto.randomUUID(),
      args: {
        project_id: args.project_id,
        merge_request_iid: args.merge_request_iid,
        file_paths: [args.new_path],
      },
    },
    { signal },
  );

  const files = JSON.parse(messageContent(result.content)) as Array<{
    new_path: string;
    diff: string;
  }>;

  const file = files.find((f) => f.new_path === args.new_path);
  return file?.diff ? parseDiffLineMap(file.diff) : undefined;
}

// Diffs the exact base_sha/head_sha GitLab reported, not branch names — a branch can move mid-review and validate against the wrong version.
async function fetchLocalDiffLineMap(
  configurable: Partial<WorkflowConfigurable>,
  newPath: string,
  baseSha: string,
  headSha: string,
  signal?: AbortSignal,
) {
  const { worktreePath } = configurable;
  if (!worktreePath) return undefined;

  const diff = await gitService.fileDiff(
    worktreePath,
    baseSha,
    headSha,
    newPath,
    signal,
  );
  // undefined when the local diff is missing/unparseable
  if (!diff.trim()) return undefined;

  const map = parseDiffLineMap(diff);
  if (!map.newLines.size && !map.oldLines.size) return undefined;
  return map;
}

const positionKey = (p: {
  new_path: string;
  old_line: number | null;
  new_line: number | null;
}) => `${p.new_path}|${p.old_line ?? ''}|${p.new_line ?? ''}`;

async function fetchOccupiedPositions(
  mrDiscussionsTool: DynamicStructuredTool,
  args: { project_id: string; merge_request_iid: string; since?: string },
  signal?: AbortSignal,
) {
  const occupied = new Set<string>();
  // Bodies of unpositioned notes, to tell "posted unanchored" apart from "not posted yet".
  const unanchoredBodies = new Set<string>();
  const sinceMs = args.since ? Date.parse(args.since) : undefined;
  // ToolCall shape (not a bare args object) so LangChain attaches an id to the resulting tool_input/tool_output events
  const result = await mrDiscussionsTool.invoke(
    {
      type: 'tool_call',
      name: mrDiscussionsTool.name,
      id: crypto.randomUUID(),
      args: {
        project_id: args.project_id,
        merge_request_iid: args.merge_request_iid,
        page: 1,
        per_page: 100,
      },
    },
    { signal },
  );

  const data = JSON.parse(messageContent(result.content)) as {
    items?: Array<{
      notes?: Array<{
        body?: string;
        created_at?: string;
        position?: {
          new_path?: string;
          old_line?: number | null;
          new_line?: number | null;
        };
      }>;
    }>;
  };

  for (const item of data.items ?? []) {
    for (const note of item.notes ?? []) {
      // Skip notes older than this run's tracking start, so a human reviewer's existing comment isn't mistaken for our own draft.
      if (sinceMs != null) {
        const noteMs = note.created_at ? Date.parse(note.created_at) : NaN;
        if (!(noteMs >= sinceMs)) continue;
      }

      const p = note.position;
      if (!p?.new_path) {
        // Position dropped (diff moved) — record by body so it isn't mistaken for "not yet posted".
        if (note.body) unanchoredBodies.add(note.body);
        continue;
      }
      occupied.add(
        positionKey({
          new_path: p.new_path,
          old_line: p.old_line ?? null,
          new_line: p.new_line ?? null,
        }),
      );
    }
  }

  return { occupied, unanchoredBodies };
}

// Validates a draft's position before create_draft_note reaches GitLab, and verifies after any publish attempt whether each tracked draft actually landed in mr_discussions — bulk_publish_draft_notes/publish_draft_note's own response is unreliable in both directions, so it's never trusted on its own.
export function draftIntegrityMiddleware({
  getFileDiffTool,
  mrDiscussionsTool,
}: {
  getFileDiffTool?: DynamicStructuredTool;
  mrDiscussionsTool?: DynamicStructuredTool;
}) {
  return createMiddleware({
    name: 'DraftIntegrity',
    wrapToolCall: async (request, handler) => {
      const runtime = request.runtime as WorkflowRuntime;
      const configurable = runtime.configurable;
      const signal = runtime.signal;
      const name = request.toolCall.name;

      // Passive cache, keyed by new_path: reuse whatever diffs the agent's normal review flow already fetches — no extra calls in the common case, and a single run only ever reviews one evolving MR state, so path alone can't go stale.
      if (
        (name === mcpToolName('gitlab', 'get_merge_request_file_diff') ||
          name === mcpToolName('gitlab', 'get_merge_request_diffs')) &&
        configurable?.diffLineMapCache
      ) {
        const result = await handler(request);

        if (ToolMessage.isInstance(result)) {
          try {
            const files = JSON.parse(messageContent(result.content)) as Array<{
              new_path: string;
              diff: string;
            }>;

            for (const file of files) {
              if (!file.diff) continue;
              configurable.diffLineMapCache.set(
                file.new_path,
                parseDiffLineMap(file.diff),
              );
            }
          } catch {
            // unparseable — the lazy fetch on create_draft_note covers it
          }
        }

        return result;
      }

      if (name === mcpToolName('gitlab', 'create_draft_note')) {
        const args = (request.toolCall.args ?? {}) as CreateDraftNoteArgs;
        const position = args.position;

        // create_draft_note only produces diff-anchored notes — a missing position would otherwise silently post as an unanchored top-level MR comment
        if (!position?.new_path) {
          const id = request.toolCall.id ?? '';
          const content = JSON.stringify({
            error:
              'create_draft_note requires position.new_path (with old_line and/or new_line) to anchor the note to a diff line. Findings outside the diff range are not commentable here.',
          });

          emitToolInputEvent(request.runtime, {
            id,
            name,
            input: request.toolCall.args ?? {},
          });
          emitToolOutputEvent(request.runtime, { id, output: content });

          return new ToolMessage({ content, tool_call_id: id });
        }

        // GitLab accepts base_sha === head_sha (a zero-width diff) but can never render the resulting note — reject it first.
        if (position.base_sha && position.head_sha === position.base_sha) {
          const id = request.toolCall.id ?? '';
          const content = JSON.stringify({
            error:
              'position.base_sha must not equal position.head_sha — use the real diff_refs from get_merge_request (base_sha is the merge-base commit, not sourceSha).',
          });

          emitToolInputEvent(request.runtime, {
            id,
            name,
            input: request.toolCall.args ?? {},
          });
          emitToolOutputEvent(request.runtime, { id, output: content });

          return new ToolMessage({ content, tool_call_id: id });
        }

        if (configurable?.diffLineMapCache) {
          let map = configurable.diffLineMapCache.get(position.new_path);

          if (
            !map &&
            !configurable.revived &&
            position.base_sha &&
            position.head_sha
          ) {
            try {
              map = await fetchLocalDiffLineMap(
                configurable,
                position.new_path,
                position.base_sha,
                position.head_sha,
                signal,
              );
            } catch (err) {
              logger.error(
                { err, path: position.new_path },
                'draftIntegrityMiddleware local diff for position validation failed — falling back to GitLab',
              );
            }
          }

          // GitLab fallback: local unavailable/unparseable, or a revived retry.
          if (
            !map &&
            getFileDiffTool &&
            args.project_id &&
            args.merge_request_iid
          ) {
            try {
              map = await fetchDiffLineMap(
                getFileDiffTool,
                {
                  project_id: args.project_id,
                  merge_request_iid: args.merge_request_iid,
                  new_path: position.new_path,
                },
                signal,
              );
            } catch (err) {
              logger.error(
                { err, path: position.new_path },
                'draftIntegrityMiddleware failed to lazy-fetch diff for position validation — skipping validation for this call',
              );
            }
          }

          if (map) configurable.diffLineMapCache.set(position.new_path, map);

          if (map) {
            const verdict = validatePosition(map, position);

            if ('error' in verdict) {
              const id = request.toolCall.id ?? '';
              const content = JSON.stringify({
                error: `Invalid position for ${position.new_path}: ${verdict.error}`,
              });

              emitToolInputEvent(request.runtime, {
                id,
                name,
                input: request.toolCall.args ?? {},
              });
              emitToolOutputEvent(request.runtime, { id, output: content });

              return new ToolMessage({ content, tool_call_id: id });
            }
          } else {
            // no map from local git or the GitLab fallback — validation silently skipped
            logger.warn(
              { path: position.new_path },
              'draftIntegrityMiddleware has no diff line map — skipping position validation, call goes to GitLab unchecked',
            );
          }
        }

        const result = await handler(request);

        // Track by draft id so the publish-verification branch below can later confirm this exact draft actually landed in mr_discussions, independent of what the publish call itself reports.
        if (configurable?.draftPositions && ToolMessage.isInstance(result)) {
          try {
            const { id } = JSON.parse(messageContent(result.content)) as {
              id?: string | number;
            };

            if (id != null && position?.new_path) {
              const draft: DraftPosition = {
                new_path: position.new_path,
                old_line: position.old_line ?? null,
                new_line: position.new_line ?? null,
                body: args.body ?? '',
              };
              configurable.draftPositions.set(String(id), draft);
              configurable.draftTrackingStartedAt ??= new Date().toISOString();
            }
          } catch {
            // untracked — publish verification below just won't cover this one
          }
        }

        return result;
      }

      if (
        (name === mcpToolName('gitlab', 'bulk_publish_draft_notes') ||
          name === mcpToolName('gitlab', 'publish_draft_note')) &&
        mrDiscussionsTool &&
        configurable?.draftPositions?.size
      ) {
        const result = await handler(request);

        // publishing itself is emulated in mock mode, so nothing real lands — verifying against live GitLab state would just be noise
        if (config.mock.workflow) return result;

        const project_id = configurable.projectId;
        const merge_request_iid = configurable.mrIid;

        if (!project_id || !merge_request_iid) return result;

        let occupied: Set<string>;
        let unanchoredBodies: Set<string>;

        try {
          ({ occupied, unanchoredBodies } = await fetchOccupiedPositions(
            mrDiscussionsTool,
            {
              project_id,
              merge_request_iid,
              since: configurable.draftTrackingStartedAt,
            },
            signal,
          ));
        } catch (err) {
          logger.error(
            { err },
            'draftIntegrityMiddleware failed to verify publish outcome — reporting the raw result as-is',
          );
          return result;
        }

        const confirmed: string[] = [];
        const unconfirmed: string[] = [];
        const postedUnanchored: string[] = [];

        for (const [draftId, draft] of configurable.draftPositions) {
          if (occupied.has(positionKey(draft))) {
            confirmed.push(draft.body);
            configurable.draftPositions.delete(draftId);
          } else if (unanchoredBodies.has(draft.body)) {
            // Published unanchored — drop tracking so it isn't retried into a duplicate.
            postedUnanchored.push(draft.body);
            configurable.draftPositions.delete(draftId);
          } else {
            unconfirmed.push(draft.body);
          }
        }

        if (
          (confirmed.length || unconfirmed.length || postedUnanchored.length) &&
          ToolMessage.isInstance(result)
        ) {
          const raw = messageContent(result.content);
          let payload: unknown;

          try {
            payload = JSON.parse(raw);
          } catch {
            payload = raw;
          }

          const base =
            payload && typeof payload === 'object' && !Array.isArray(payload)
              ? (payload as Record<string, unknown>)
              : { result: payload };

          const notes = [
            postedUnanchored.length
              ? `${postedUnanchored.length} draft(s) were posted but GitLab could not anchor them to the diff line — they landed as plain top-level comments instead. Do not retry publishing these (that would duplicate them); say so plainly in the summary.`
              : '',
            unconfirmed.length
              ? `${unconfirmed.length} draft(s) have no matching entry in mr_discussions yet — do not report these as posted. Retry via publish_draft_note, then re-check mr_discussions; if still missing after a retry, say so plainly in the summary.`
              : '',
          ].filter(Boolean);

          result.content = JSON.stringify({
            ...base,
            verification: {
              confirmedInMrDiscussions: confirmed,
              postedButUnanchored: postedUnanchored,
              notYetConfirmed: unconfirmed,
              note: notes.length
                ? notes.join(' ')
                : 'All tracked drafts are confirmed present in mr_discussions.',
            },
            // preserves an underlying error (e.g. a real 500) instead of clobbering it — FE red-highlights on this key
            ...(unconfirmed.length || postedUnanchored.length
              ? {
                  error: [
                    base.error,
                    unconfirmed.length
                      ? `${unconfirmed.length} draft(s) not confirmed in mr_discussions.`
                      : '',
                    postedUnanchored.length
                      ? `${postedUnanchored.length} draft(s) posted unanchored.`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' '),
                }
              : {}),
          });

          // on_tool_end already fired with the raw pre-verification output (tied to the tool's own invoke() inside handler() above) — re-emit tool_output so the log shows whether the draft actually landed, not the stale unverified result.
          emitToolOutputEvent(request.runtime, {
            id: request.toolCall.id ?? '',
            output: messageContent(result.content),
          });
        }

        return result;
      }

      return handler(request);
    },
  });
}
