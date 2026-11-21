import type { GraphNode } from '@langchain/langgraph';

import { type GitHost, InstructionStatus, WorkflowNode } from '#types.js';

import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import { workflowState } from '#components/workflows/mr-review/state.js';

import { config as appConfig } from '#utils/config.js';
import { logger } from '#utils/logger.js';
import { reviewNote } from '#utils/notes.js';

export const notifyReviewStatusNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const { query, model, statusCommentId } = state;
  const instructionStatus = state.config.instructions.status;
  const { projectPath, codeChangeRequestNumber } = query;
  const host = config.configurable?.host as GitHost;
  const threadId = config.configurable?.thread_id as string | undefined;
  const runId = config.configurable?.run_id as string | undefined;
  // we should always certainly get the node name despite its type being undefined
  let node = config.metadata?.langgraph_node as string | undefined;
  const isReviewCompleted = node === WorkflowNode.NotifyReviewEnd;
  const body = isReviewCompleted
    ? reviewNote.completed(
        host,
        model,
        instructionStatus ?? InstructionStatus.Missing,
        threadId,
      ) // Instruction status is guaranteed to be set by this point
    : reviewNote.inProgress(host, model, InstructionStatus.Loading, threadId);
  let updatedCommentId;

  if (!node) {
    logger.warn(
      { runId, threadId },
      `Node detection failed for notifyReviewStatusNode, falling back to state derived name`,
    );
    node = statusCommentId
      ? WorkflowNode.NotifyReviewEnd
      : WorkflowNode.NotifyReviewStart;
  }

  emitNodeLifecycleEvents(config, { event: 'node_start', data: { node } });

  if (!appConfig.mock.workflow) {
    updatedCommentId = await host.upsertCodeChangeRequestComment(
      projectPath,
      codeChangeRequestNumber,
      body,
      statusCommentId,
    );
  }

  emitNodeLifecycleEvents(config, { event: 'node_end', data: { node } });

  return isReviewCompleted
    ? {}
    : {
        statusCommentId: updatedCommentId,
        config: {
          ...state.config,
          instructions: {
            ...state.config.instructions,
            status: InstructionStatus.Loading,
          },
        },
      };
};
