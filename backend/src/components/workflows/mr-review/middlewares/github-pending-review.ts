import { type Schema, validate } from '@cfworker/json-schema';
import { ToolMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { createMiddleware } from 'langchain';

import { GitProvider } from '#types.js';

import { gitService } from '#components/repositories/service.js';
import {
  emitToolInputEvent,
  emitToolOutputEvent,
} from '#components/workflows/emit.js';
import type {
  WorkflowConfigurable,
  WorkflowRuntime,
} from '#components/workflows/mr-review/state.js';

import { config } from '#utils/config.js';
import {
  type DiffLineMap,
  parseDiffLineMap,
  validateSidedPosition,
} from '#utils/diff.js';
import {
  mcpToolName,
  messageContent,
  toolErrorContent,
} from '#utils/helpers.js';
import { logger } from '#utils/logger.js';

const ADD_COMMENT = mcpToolName(
  GitProvider.GitHub,
  'add_comment_to_pending_review',
);
const ADD_REPLY = mcpToolName(
  GitProvider.GitHub,
  'add_reply_to_pull_request_comment',
);
const PULL_REQUEST_READ = mcpToolName(GitProvider.GitHub, 'pull_request_read');
const REVIEW_WRITE = mcpToolName(
  GitProvider.GitHub,
  'pull_request_review_write',
);

type Side = 'LEFT' | 'RIGHT';
type CommentArgs = {
  path?: string;
  line?: number;
  side?: Side;
  startLine?: number;
  startSide?: Side;
  subjectType?: 'FILE' | 'LINE';
  body?: string;
};

// ToolCall shape (not a bare args object) so LangChain attaches an id to the resulting tool_input/tool_output events
const invokeTool = (
  tool: DynamicStructuredTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) =>
  tool.invoke(
    { type: 'tool_call', name: tool.name, id: crypto.randomUUID(), args },
    { signal },
  );

// Answers a call without forwarding it, still logging it like any other tool call.
function respond(
  runtime: Parameters<typeof emitToolInputEvent>[0],
  toolCall: { id?: string; name: string; args?: Record<string, unknown> },
  content: string,
) {
  const id = toolCall.id ?? '';
  emitToolInputEvent(runtime, {
    id,
    name: toolCall.name,
    input: toolCall.args ?? {},
  });
  emitToolOutputEvent(runtime, { id, output: content });
  return new ToolMessage({ content, tool_call_id: id });
}

// Same check LangChain runs before a real call — a held call skips it, so a bad one would otherwise surface only when forwarded at submit.
const schemaError = (
  tool: DynamicStructuredTool | undefined,
  args: Record<string, unknown>,
) => {
  if (!tool) return undefined;
  const { valid, errors } = validate(args, tool.schema as Schema);
  return valid
    ? undefined
    : `Received tool input did not match expected schema: ${errors.map((e) => e.error).join(' ')}`;
};

const errorOutput = (result: unknown): string | undefined =>
  ToolMessage.isInstance(result)
    ? result.status === 'error'
      ? messageContent(result.content)
      : toolErrorContent(result)
    : undefined;

type PullRequestFile = { filename: string; patch?: string };

const parseFiles = (content: string): PullRequestFile[] => {
  const parsed = JSON.parse(content) as
    PullRequestFile[] | { files?: PullRequestFile[] };
  return Array.isArray(parsed) ? parsed : (parsed.files ?? []);
};

async function diffLineMapFor(
  configurable: Partial<WorkflowConfigurable>,
  path: string,
  pullRequestReadTool: DynamicStructuredTool | undefined,
  signal?: AbortSignal,
): Promise<DiffLineMap | undefined> {
  const cached = configurable.diffLineMapCache?.get(path);
  if (cached) return cached;

  const { worktreePath, sourceBranch, targetBranch, revived } = configurable;
  let diff = '';

  if (!revived && worktreePath && sourceBranch && targetBranch) {
    try {
      const base = await gitService.mergeBase(
        worktreePath,
        sourceBranch,
        targetBranch,
        signal,
      );
      diff = await gitService.fileDiff(
        worktreePath,
        base,
        sourceBranch,
        path,
        signal,
      );
    } catch (err) {
      logger.error(
        { err, path },
        'githubPendingReviewMiddleware local diff for position validation failed — falling back to GitHub',
      );
    }
  }

  // GitHub fallback: local unavailable, or a revived retry whose branch is gone.
  if (!diff.trim() && pullRequestReadTool) {
    const [owner, repo] = (configurable.projectPath ?? '').split('/');
    try {
      const result = await invokeTool(
        pullRequestReadTool,
        {
          method: 'get_files',
          owner,
          repo,
          pullNumber: Number(configurable.codeChangeRequestNumber),
          perPage: 100,
        },
        signal,
      );
      diff =
        parseFiles(messageContent(result.content)).find(
          (f) => f.filename === path,
        )?.patch ?? '';
    } catch (err) {
      logger.error(
        { err, path },
        'githubPendingReviewMiddleware failed to fetch the file diff from GitHub — skipping position validation for this call',
      );
    }
  }

  if (!diff.trim()) return undefined;
  const map = parseDiffLineMap(diff);
  if (!map.newLines.size && !map.oldLines.size) return undefined;
  configurable.diffLineMapCache?.set(path, map);
  return map;
}

const positionKey = (path: string, line: number | undefined) =>
  `${path}|${line ?? ''}`;

// Comments the bot posted on this PR since its review started, by path and line — GitHub's thread listing carries no comment id or side to match on.
async function fetchPostedPositions(
  pullRequestReadTool: DynamicStructuredTool,
  configurable: Partial<WorkflowConfigurable>,
  signal?: AbortSignal,
) {
  const [owner, repo] = (configurable.projectPath ?? '').split('/');
  const sinceMs = configurable.draftTrackingStartedAt
    ? Date.parse(configurable.draftTrackingStartedAt)
    : undefined;
  const botLogin = config.github.username.toLowerCase();
  const posted = new Set<string>();
  let after: string | undefined;

  do {
    const result = await invokeTool(
      pullRequestReadTool,
      {
        method: 'get_review_comments',
        owner,
        repo,
        pullNumber: Number(configurable.codeChangeRequestNumber),
        perPage: 100,
        ...(after && { after }),
      },
      signal,
    );
    const data = JSON.parse(messageContent(result.content)) as {
      review_threads?: Array<{
        comments?: Array<{
          path?: string;
          line?: number;
          original_line?: number;
          author?: string;
          created_at?: string;
        }>;
      }>;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string };
    };

    for (const thread of data.review_threads ?? []) {
      for (const comment of thread.comments ?? []) {
        if ((comment.author ?? '').toLowerCase() !== botLogin) continue;
        // Skip comments older than this run's tracking start, so an earlier round's comment isn't mistaken for this one's.
        if (
          sinceMs != null &&
          !(Date.parse(comment.created_at ?? '') >= sinceMs)
        )
          continue;
        if (!comment.path) continue;
        posted.add(
          positionKey(comment.path, comment.line ?? comment.original_line),
        );
      }
    }

    after = data.pageInfo?.hasNextPage ? data.pageInfo.endCursor : undefined;
  } while (after);

  return posted;
}

// GitHub can't withdraw a comment once it's on a pending review, so comments and replies are held until submit — commentCriticMiddleware, outside this one, drops rejected ones from the hold first.
export function githubPendingReviewMiddleware({
  pullRequestReadTool,
  addCommentTool,
  addReplyTool,
}: {
  pullRequestReadTool?: DynamicStructuredTool;
  addCommentTool?: DynamicStructuredTool;
  addReplyTool?: DynamicStructuredTool;
}) {
  return createMiddleware({
    name: 'GitHubPendingReview',
    wrapToolCall: async (request, handler) => {
      const runtime = request.runtime as WorkflowRuntime;
      const configurable = runtime.configurable;
      const signal = runtime.signal;
      const { toolCall } = request;
      const args = (toolCall.args ?? {}) as Record<string, unknown>;
      const held = configurable?.heldReviewComments;

      if (!held) return handler(request);

      // Passive cache, keyed by path: reuse the file patches the agent's normal review flow already fetches — no extra calls in the common case.
      if (
        toolCall.name === PULL_REQUEST_READ &&
        args.method === 'get_files' &&
        configurable.diffLineMapCache
      ) {
        const result = await handler(request);

        if (ToolMessage.isInstance(result)) {
          try {
            for (const file of parseFiles(messageContent(result.content))) {
              if (!file.patch) continue;
              configurable.diffLineMapCache.set(
                file.filename,
                parseDiffLineMap(file.patch),
              );
            }
          } catch {
            // unparseable — the lazy fetch on add_comment_to_pending_review covers it
          }
        }

        return result;
      }

      if (toolCall.name === ADD_COMMENT) {
        const {
          path,
          line,
          side = 'RIGHT',
          startLine,
          startSide,
          subjectType,
        } = args as CommentArgs;

        const invalid = schemaError(addCommentTool, args);
        if (invalid)
          return respond(
            request.runtime,
            toolCall,
            JSON.stringify({ error: invalid }),
          );

        if (!path || (subjectType !== 'FILE' && line == null)) {
          return respond(
            request.runtime,
            toolCall,
            JSON.stringify({
              error:
                'add_comment_to_pending_review requires path and line (with side) to anchor the comment to a diff line, or subjectType "FILE" for a whole-file comment. Findings outside the diff range are not commentable here.',
            }),
          );
        }

        if (subjectType !== 'FILE' && line != null) {
          const map = await diffLineMapFor(
            configurable,
            path,
            pullRequestReadTool,
            signal,
          );

          if (map) {
            const verdict = validateSidedPosition(map, {
              line,
              side,
              startLine,
              startSide,
            });
            if ('error' in verdict) {
              return respond(
                request.runtime,
                toolCall,
                JSON.stringify({
                  error: `Invalid position for ${path}: ${verdict.error}`,
                }),
              );
            }
          } else {
            logger.warn(
              { path },
              'githubPendingReviewMiddleware has no diff line map — skipping position validation, comment goes to GitHub unchecked',
            );
          }
        }

        held.set(toolCall.id ?? crypto.randomUUID(), {
          toolName: toolCall.name,
          args,
        });
        configurable.draftTrackingStartedAt ??= new Date().toISOString();
        return respond(
          request.runtime,
          toolCall,
          'pull request review comment successfully added to pending review',
        );
      }

      // A reaction alone isn't review content, so only a reply with a body is held.
      if (toolCall.name === ADD_REPLY && typeof args.body === 'string') {
        const invalid = schemaError(addReplyTool, args);
        if (invalid)
          return respond(
            request.runtime,
            toolCall,
            JSON.stringify({ error: invalid }),
          );

        held.set(toolCall.id ?? crypto.randomUUID(), {
          toolName: toolCall.name,
          args,
        });
        configurable.draftTrackingStartedAt ??= new Date().toISOString();
        return respond(
          request.runtime,
          toolCall,
          'reply added — it posts together with the review when the pending review is submitted',
        );
      }

      const submits =
        toolCall.name === REVIEW_WRITE &&
        (args.method === 'submit_pending' ||
          (args.method === 'create' && !!args.event));

      if (!submits) return handler(request);

      const heldComments = [...held].filter(
        ([, c]) => c.toolName === ADD_COMMENT,
      );

      // create with an event submits a brand-new review in one call, so there's no pending review to attach held comments to.
      if (args.method === 'create' && heldComments.length) {
        return respond(
          request.runtime,
          toolCall,
          JSON.stringify({
            error:
              'There are review comments waiting on the pending review — submit them with pull_request_review_write method "submit_pending" (creating the pending review first with method "create" and no event, if you haven\'t).',
          }),
        );
      }

      // Forwarding is emulated in mock mode, so nothing real is posted — and nothing real to verify.
      if (config.mock.workflow) {
        held.clear();
        return handler(request);
      }

      const failed: Array<{ body: string; error: string }> = [];
      const comments: Array<{ body: string; key: string }> = [];
      const replies: string[] = [];

      for (const [id, comment] of held) {
        const tool =
          comment.toolName === ADD_COMMENT ? addCommentTool : addReplyTool;
        const body = String(comment.args.body ?? '');
        let error: string | undefined;
        try {
          if (!tool) throw new Error(`${comment.toolName} isn't available`);
          error = errorOutput(await invokeTool(tool, comment.args, signal));
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        held.delete(id);
        if (error) failed.push({ body, error });
        else if (comment.toolName === ADD_COMMENT)
          comments.push({
            body,
            key: positionKey(
              String(comment.args.path),
              comment.args.line as number | undefined,
            ),
          });
        else replies.push(body);
      }

      // Left pending so the failed ones can be re-added and submitted with the rest — a retry after submitting would need an identical "create", which duplicateCallGuardMiddleware blocks.
      if (failed.length) {
        return respond(
          request.runtime,
          toolCall,
          JSON.stringify({
            error: `${failed.length} comment(s) failed to post to the pending review, so it was not submitted.`,
            failed,
            note: 'The other comments are on the pending review. Fix and re-add the failed ones, then submit again.',
          }),
        );
      }

      const result = await handler(request);

      if (!comments.length) return result;

      let posted = new Set<string>();
      if (comments.length && pullRequestReadTool && !errorOutput(result)) {
        try {
          posted = await fetchPostedPositions(
            pullRequestReadTool,
            configurable,
            signal,
          );
        } catch (err) {
          logger.error(
            { err },
            'githubPendingReviewMiddleware failed to verify the submitted review — reporting the raw result as-is',
          );
          return result;
        }
      }

      const confirmed = comments
        .filter((c) => posted.has(c.key))
        .map((c) => c.body);
      const unconfirmed = comments
        .filter((c) => !posted.has(c.key))
        .map((c) => c.body);

      if (!ToolMessage.isInstance(result)) return result;

      const raw = messageContent(result.content);
      result.content = JSON.stringify({
        result: raw,
        verification: {
          // New inline comments only — the thread page counts these as opened threads.
          confirmedInReviewThreads: confirmed,
          repliesPosted: replies,
          notYetConfirmed: unconfirmed,
          note: unconfirmed.length
            ? `${unconfirmed.length} comment(s) have no matching entry in the review threads yet — do not report these as posted, and do not post them again, which could duplicate them. Say plainly in the summary that they couldn't be confirmed.`
            : 'All comments are confirmed present in the review threads.',
        },
        // FE red-highlights on this key
        ...(unconfirmed.length && {
          error: `${unconfirmed.length} comment(s) not confirmed in the review threads.`,
        }),
      });

      // on_tool_end already fired with the raw pre-verification output — re-emit so the log shows what actually landed.
      emitToolOutputEvent(request.runtime, {
        id: toolCall.id ?? '',
        output: messageContent(result.content),
      });

      return result;
    },
  });
}
