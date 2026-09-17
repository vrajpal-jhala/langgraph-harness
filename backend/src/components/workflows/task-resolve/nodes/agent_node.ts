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
  const { sandbox, workingDirectory, worktreePath, mrIid } =
    config.configurable as Partial<TaskResolveAgentConfigurable>;
  const threadId = config.configurable?.thread_id as string | undefined;

  if (!sandbox || !workingDirectory || !worktreePath || !threadId) {
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
        identifiers: `project_id "${projectPath}"`,
        model,
        sandbox,
        workingDirectory,
        worktreePath,
        projectId: projectPath,
        issueIid: null,
        mrIid: mrIid ?? null,
        threadId,
        workflow: 'task-resolve',
        recursionLimit: appConfig.taskResolve.recursionLimit,
        signal,
      },
      config,
    );
    return { messages: updatedMessages, lastRunReplyNoteIds: replyNoteIds };
  } finally {
    emitNodeLifecycleEvents(config, {
      event: 'node_end',
      data: { node: WorkflowNode.Agent },
    });
  }
};
