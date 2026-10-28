import type { GraphNode } from '@langchain/langgraph';

import { WorkflowNode } from '#types.js';

import { agent } from '#components/workflows/agent.js';
import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import type { TaskResolveAgentConfigurable } from '#components/workflows/state.js';
import { taskResolveState } from '#components/workflows/task-resolve/state.js';

import { config as appConfig } from '#utils/config.js';

export const agentNode: GraphNode<typeof taskResolveState> = async (
  state,
  config,
) => {
  const {
    title,
    projectPath,
    prompt,
    taskType,
    model,
    messages,
    config: workflowConfig,
  } = state;
  const repoInstructions = workflowConfig.instructions.content;
  const { signal } = config;
  const {
    host,
    sandbox,
    workingDirectory,
    worktreePath,
    codeChangeRequestNumber,
  } = config.configurable as Partial<TaskResolveAgentConfigurable>;
  const threadId = config.configurable?.thread_id as string | undefined;

  if (!host || !sandbox || !workingDirectory || !worktreePath || !threadId) {
    throw new Error(
      'Agent node invoked without a sandbox and thread configured.',
    );
  }

  emitNodeLifecycleEvents(config, {
    event: 'node_start',
    data: { node: WorkflowNode.Agent },
  });

  try {
    const { messages: updatedMessages, replyNoteIds } = await agent.invoke(
      messages,
      {
        taskTitle: title,
        taskDescription: prompt,
        taskType,
        repoInstructions,
        taskSource: 'carrying out a user-submitted task',
        identifiers: host.repoIdentifiers(projectPath),
        host,
        model,
        sandbox,
        workingDirectory,
        worktreePath,
        repoKey: host.repoKey(projectPath),
        issueNumber: null,
        codeChangeRequestNumber: codeChangeRequestNumber ?? null,
        threadId,
        workflow: 'task-resolve',
        recursionLimit: appConfig.taskResolve.recursionLimit,
        signal,
      },
      config,
    );
    return { messages: updatedMessages, lastRunReplyCommentIds: replyNoteIds };
  } finally {
    emitNodeLifecycleEvents(config, {
      event: 'node_end',
      data: { node: WorkflowNode.Agent },
    });
  }
};
