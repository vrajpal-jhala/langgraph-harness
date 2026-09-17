import type { GraphNode } from '@langchain/langgraph';

import { WorkflowNode } from '#types.js';

import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import { workflowState } from '#components/workflows/work-item-resolve/state.js';

import { config as appConfig } from '#utils/config.js';
import { upsertIssueNote } from '#utils/gitlab.js';
import { logger } from '#utils/logger.js';
import { workItemResolveNote } from '#utils/notes.js';

export const notifyIssueStatusNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const { projectPath, issueIid, model, noteId } = state;
  const instructionStatus = state.config.instructions.status;
  const threadId = config.configurable?.thread_id as string | undefined;
  const runId = config.configurable?.run_id as string | undefined;

  emitNodeLifecycleEvents(config, {
    event: 'node_start',
    data: { node: WorkflowNode.NotifyIssueStart },
  });

  const updatedNoteId = appConfig.mock.workflow
    ? undefined
    : await upsertIssueNote(
        projectPath,
        issueIid,
        workItemResolveNote.working(model, instructionStatus, threadId),
        noteId,
      ).catch((err) => {
        logger.error({ err, runId, threadId }, 'Error posting issue note');
        return noteId;
      });

  emitNodeLifecycleEvents(config, {
    event: 'node_end',
    data: { node: WorkflowNode.NotifyIssueStart },
  });

  return { noteId: updatedNoteId };
};
