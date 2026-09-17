import type { GraphNode } from '@langchain/langgraph';

import { WorkflowNode } from '#types.js';

import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import { agent } from '#components/workflows/mr-review/agent.js';
import { workflowState } from '#components/workflows/mr-review/state.js';

export const agentNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const { query, reasoning, model, messages, config: workflowConfig } = state;
  const repoInstructions = workflowConfig.instructions.content;
  const { signal } = config;
  const worktreePath = config.configurable?.worktreePath as string;
  const revived = config.configurable?.revived as boolean;

  emitNodeLifecycleEvents(config, {
    event: 'node_start',
    data: { node: WorkflowNode.Agent },
  });

  try {
    const updatedMessages = await agent.invoke(
      messages,
      query,
      model,
      reasoning,
      worktreePath,
      revived,
      config,
      repoInstructions,
      signal,
    );
    return { messages: updatedMessages };
  } finally {
    emitNodeLifecycleEvents(config, {
      event: 'node_end',
      data: { node: WorkflowNode.Agent },
    });
  }
};
