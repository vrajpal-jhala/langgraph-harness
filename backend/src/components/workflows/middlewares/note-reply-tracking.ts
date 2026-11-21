import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import { threadsDal } from '#components/threads/dal.js';
import type { SandboxAgentRuntime } from '#components/workflows/state.js';

import { messageContent } from '#utils/helpers.js';
import { logger } from '#utils/logger.js';

// Records every discussion reply this run posts, so a later run can tell its
// own comments apart from a human's when deciding what's new — without this
// the bot would treat its own reply as fresh feedback and loop on it forever.
export function noteReplyTrackingMiddleware() {
  return createMiddleware({
    name: 'NoteReplyTracking',
    wrapToolCall: async (request, handler) => {
      const runtime = request.runtime as SandboxAgentRuntime;
      const configurable = runtime.configurable;
      if (
        !configurable?.host?.discussion.replies.includes(request.toolCall.name)
      ) {
        return handler(request);
      }

      const result = await handler(request);
      if (!ToolMessage.isInstance(result)) return result;

      if (!configurable?.postedReplyNoteIds || !configurable.threadId) {
        return result;
      }

      try {
        // GitLab's tool returns the id as a string, GitHub's as a number — stored as strings like the webhook-side comparison expects.
        const { id: rawId } = JSON.parse(messageContent(result.content)) as {
          id?: string | number;
        };
        if (rawId == null) return result;
        const id = String(rawId);

        configurable.postedReplyNoteIds.push(id);
        // Persisted immediately, not just at run end — to prevent self-loop.
        await threadsDal
          .mergeMetadata(configurable.threadId, {
            lastRunReplyCommentIds: configurable.postedReplyNoteIds,
          })
          .catch((err) =>
            logger.error(
              { err, noteId: id },
              '[note-reply-tracking] failed to persist own-note id, self-trigger exclusion may lag this run',
            ),
          );
      } catch {
        // unparseable — self-loop exclusion just won't cover this reply
      }

      return result;
    },
  });
}
