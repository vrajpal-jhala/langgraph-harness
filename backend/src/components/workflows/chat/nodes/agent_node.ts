import { GraphNode } from '@langchain/langgraph';

import { chatAgent } from '#components/workflows/chat/agent.js';
import {
  ChatConfigurable,
  chatState,
} from '#components/workflows/chat/state.js';
import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';

export const chatAgentNode: GraphNode<typeof chatState> = async (
  state,
  config,
) => {
  const { query, reasoning, model, messages } = state;
  const { signal } = config;
  const configurable = config.configurable as Partial<ChatConfigurable>;

  emitNodeLifecycleEvents(config, {
    event: 'node_start',
    data: { node: 'agent' },
  });

  try {
    const updatedMessages = await chatAgent.invoke(
      messages,
      query,
      model,
      reasoning,
      configurable?.chatTools ?? [],
      configurable?.openRouterKey ?? '',
      configurable?.toolsEnabled,
      configurable?.userId,
      configurable?.currentThreadId ?? '',
      signal,
      configurable?.resuming ?? false,
    );
    return { messages: updatedMessages };
  } finally {
    emitNodeLifecycleEvents(config, {
      event: 'node_end',
      data: { node: 'agent' },
    });
  }
};
