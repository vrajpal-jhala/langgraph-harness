import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import { GitProvider } from '#types.js';

import {
  emitToolInputEvent,
  emitToolOutputEvent,
} from '#components/workflows/emit.js';
import type {
  WorkflowConfigurable,
  WorkflowRuntime,
} from '#components/workflows/mr-review/state.js';

import { config } from '#utils/config.js';
import { mcpToolName, mentionsUser, messageContent } from '#utils/helpers.js';

type Note = { id: string; author: string; body: string };
type Call = { name: string; args: Record<string, unknown> };
type Run = Pick<
  WorkflowConfigurable,
  | 'answerTaggedComments'
  | 'replyOnly'
  | 'taggedDiscussionIds'
  | 'ownDiscussionIds'
>;

const REPLY_ONLY_ERROR =
  'This run only answers comments that tag you and resolves settled threads — no new findings, drafts or approvals. A new push gets its own review.';
const TAGGED_ONLY_ERROR =
  'Only reply in a thread where someone else tagged you, as listed by the review threads.';
const RESOLVE_ERROR =
  'Only resolve threads you started, as listed by the review threads — a thread someone else started is theirs to resolve.';

const gitlabTool = (name: string) => mcpToolName(GitProvider.GitLab, name);
const GITLAB_FINDING_TOOLS = new Set(
  [
    'create_draft_note',
    'bulk_publish_draft_notes',
    'publish_draft_note',
    'approve_merge_request',
    'unapprove_merge_request',
  ].map(gitlabTool),
);

// Each provider lists its threads with their notes, and says why a call is rejected.
const PROVIDERS = {
  [GitProvider.GitLab]: {
    listedThreads: (call: Call, content: string) => {
      if (call.name !== gitlabTool('mr_discussions')) return undefined;
      const parsed = JSON.parse(content);
      const discussions: {
        id: string;
        notes?: {
          id?: number;
          body?: string;
          system?: boolean;
          author?: { username?: string };
        }[];
      }[] = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
      return discussions.map((d) => ({
        id: d.id,
        notes: (d.notes ?? [])
          // System notes like "requested review from @bot" would otherwise count as a person tagging the bot.
          .filter((n) => !n.system)
          .map((n) => ({
            id: String(n.id),
            author: n.author?.username ?? '',
            body: n.body ?? '',
          })),
      }));
    },
    rejection: (call: Call, run: Run) => {
      if (run.replyOnly && GITLAB_FINDING_TOOLS.has(call.name))
        return REPLY_ONLY_ERROR;
      const discussionId = String(call.args.discussion_id ?? '');
      if (call.name === gitlabTool('create_merge_request_discussion_note')) {
        if (!run.answerTaggedComments)
          return 'An issue or task workflow owns this merge request, so answering comments is its job. Post findings with create_draft_note anchored to a diff line.';
        if (!run.taggedDiscussionIds.has(discussionId))
          return `${TAGGED_ONLY_ERROR} Post new findings with create_draft_note anchored to a diff line.`;
      }
      if (
        call.name === gitlabTool('resolve_merge_request_thread') &&
        !run.ownDiscussionIds.has(discussionId)
      )
        return RESOLVE_ERROR;
      return undefined;
    },
  },
  [GitProvider.GitHub]: {
    listedThreads: (call: Call, content: string) => {
      if (
        call.name !== mcpToolName(GitProvider.GitHub, 'pull_request_read') ||
        call.args.method !== 'get_review_comments'
      )
        return undefined;
      const threads: {
        id: string;
        comments?: { author?: string; body?: string; html_url?: string }[];
      }[] = JSON.parse(content).review_threads ?? [];
      return threads.map((t) => ({
        id: t.id,
        notes: (t.comments ?? []).map((c) => ({
          // `submit_review` replies name a comment by the number in its `#discussion_r` anchor.
          id: c.html_url?.match(/discussion_r(\d+)$/)?.[1] ?? '',
          author: c.author ?? '',
          body: c.body ?? '',
        })),
      }));
    },
    rejection: (call: Call, run: Run) => {
      if (
        call.name === 'resolve_review_thread' &&
        !run.ownDiscussionIds.has(String(call.args.threadId ?? ''))
      )
        return RESOLVE_ERROR;
      // A full review's replies also follow up its own findings, and the comment critic already screens them.
      if (call.name !== 'submit_review' || !run.replyOnly) return undefined;
      const {
        event,
        comments = [],
        replies = [],
      } = call.args as {
        event?: string;
        comments?: unknown[];
        replies?: { commentId?: number | string }[];
      };
      if (comments.length || event !== 'COMMENT') return REPLY_ONLY_ERROR;
      const stray = replies.filter(
        (r) => !run.taggedDiscussionIds.has(String(r.commentId)),
      );
      return stray.length
        ? `${TAGGED_ONLY_ERROR} Not tagged: ${stray.map((r) => r.commentId).join(', ')}. Submit again without those.`
        : undefined;
    },
  },
};

export function threadPermissionsMiddleware(provider: GitProvider) {
  const { listedThreads, rejection } = PROVIDERS[provider];
  const bot = config[provider].username;

  return createMiddleware({
    name: 'ThreadPermissions',
    wrapToolCall: async (request, handler) => {
      const run = (request.runtime as WorkflowRuntime).configurable as
        Run | undefined;
      if (!run?.taggedDiscussionIds) return handler(request);
      const call = {
        name: request.toolCall.name,
        args: (request.toolCall.args ?? {}) as Record<string, unknown>,
      };

      const error = rejection(call, run);
      if (error) {
        const id = request.toolCall.id ?? '';
        const content = JSON.stringify({ error });
        emitToolInputEvent(request.runtime, {
          id,
          name: call.name,
          input: call.args,
        });
        emitToolOutputEvent(request.runtime, { id, output: content });
        return new ToolMessage({ content, tool_call_id: id });
      }

      const result = await handler(request);
      if (!ToolMessage.isInstance(result)) return result;

      try {
        const isBot = (n: Note) => n.author.toLowerCase() === bot;
        for (const thread of listedThreads(
          call,
          messageContent(result.content),
        ) ?? []) {
          // GitHub resolves by thread id but replies by comment id, so a thread is known by both.
          const keys = [thread.id, ...thread.notes.map((n) => n.id)];
          if (thread.notes[0] && isBot(thread.notes[0]))
            keys.forEach((k) => run.ownDiscussionIds.add(k));
          if (thread.notes.some((n) => !isBot(n) && mentionsUser(n.body, bot)))
            keys.forEach((k) => run.taggedDiscussionIds.add(k));
        }
      } catch {
        // Unreadable listing — replies and resolves stay rejected until a readable one arrives.
      }
      return result;
    },
  });
}
