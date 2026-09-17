import type { GraphNode } from '@langchain/langgraph';

import { InstructionStatus, WorkflowNode } from '#types.js';

import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import { workflowState } from '#components/workflows/mr-review/state.js';

import { config as appConfig } from '#utils/config.js';
import { upsertMrNote } from '#utils/gitlab.js';
import { logger } from '#utils/logger.js';
import { mrNote } from '#utils/notes.js';

export const notifyReviewStatusNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const { query, model, noteId } = state;
  const instructionStatus = state.config.instructions.status;
  const { projectId, mrIid } = query;
  const threadId = config.configurable?.thread_id as string | undefined;
  const runId = config.configurable?.run_id as string | undefined;
  // we should always certainly get the node name despite its type being undefined
  let node = config.metadata?.langgraph_node as string | undefined;
  const isReviewCompleted = node === WorkflowNode.NotifyReviewEnd;
  const body = isReviewCompleted
    ? mrNote.completed(
        model,
        instructionStatus ?? InstructionStatus.Missing,
        threadId,
      ) // Instruction status is guaranteed to be set by this point
    : mrNote.inProgress(model, InstructionStatus.Loading, threadId);
  let updatedNoteId;

  if (!node) {
    logger.warn(
      { runId, threadId },
      `Node detection failed for notifyReviewStatusNode, falling back to state derived name`,
    );
    node = noteId
      ? WorkflowNode.NotifyReviewEnd
      : WorkflowNode.NotifyReviewStart;
  }

  emitNodeLifecycleEvents(config, { event: 'node_start', data: { node } });

  if (!appConfig.mock.workflow) {
    updatedNoteId = await upsertMrNote(projectId, mrIid, body, noteId);
  }

  emitNodeLifecycleEvents(config, { event: 'node_end', data: { node } });

  return isReviewCompleted
    ? {}
    : {
        noteId: updatedNoteId,
        config: {
          ...state.config,
          instructions: {
            ...state.config.instructions,
            status: InstructionStatus.Loading,
          },
        },
      };
};
