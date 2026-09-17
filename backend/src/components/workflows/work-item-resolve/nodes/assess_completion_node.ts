import type { GraphNode } from '@langchain/langgraph';

import { CompletionStatus, WorkflowNode } from '#types.js';

import { assessCompletion } from '#components/workflows/completion-assessor.js';
import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import { workflowState } from '#components/workflows/work-item-resolve/state.js';

export const assessCompletionNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const { messages, model, config: workflowConfig } = state;
  const repoInstructions = workflowConfig.instructions.content;

  emitNodeLifecycleEvents(config, {
    event: 'node_start',
    data: { node: WorkflowNode.AssessCompletion },
  });

  let status: CompletionStatus = '' as CompletionStatus;
  let summary = '';
  let error = '';
  let retries = 0;
  let maxRetries = 0;
  try {
    const result = await assessCompletion({
      messages,
      model,
      repoInstructions,
    });
    status = result.status;
    summary = result.summary;
    retries = result.retries;
    maxRetries = result.maxRetries;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // The agent's work must not be lost just because this classifier call failed.
    status = CompletionStatus.Partial;
    summary =
      'Automated completion assessment failed after retries — review the merge request directly.';
  } finally {
    emitNodeLifecycleEvents(config, {
      event: 'node_end',
      data: {
        node: WorkflowNode.AssessCompletion,
        payload: { status, summary, error, retries, maxRetries },
      },
    });
  }

  return { completionStatus: status, completionSummary: summary };
};
