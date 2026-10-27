import type { GraphNode } from '@langchain/langgraph';

import { type GitHost, WorkflowNode } from '#types.js';

import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import { workflowState } from '#components/workflows/work-item-resolve/state.js';

import { config as appConfig } from '#utils/config.js';
import { logger } from '#utils/logger.js';
import { workItemResolveNote } from '#utils/notes.js';

export const notifyIssueStatusNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const { projectPath, issueIid, model, statusCommentId } = state;
  const instructionStatus = state.config.instructions.status;
  const threadId = config.configurable?.thread_id as string | undefined;
  const host = config.configurable?.host as GitHost;
  const runId = config.configurable?.run_id as string | undefined;

  emitNodeLifecycleEvents(config, {
    event: 'node_start',
    data: { node: WorkflowNode.NotifyIssueStart },
  });

  const updatedStatusCommentId = appConfig.mock.workflow
    ? undefined
    : await host
        .upsertIssueComment(
          projectPath,
          issueIid,
          workItemResolveNote.working(host, model, instructionStatus, threadId),
          statusCommentId,
        )
        .catch((err) => {
          logger.error({ err, runId, threadId }, 'Error posting issue note');
          return statusCommentId;
        });

  emitNodeLifecycleEvents(config, {
    event: 'node_end',
    data: { node: WorkflowNode.NotifyIssueStart },
  });

  return { statusCommentId: updatedStatusCommentId };
};
