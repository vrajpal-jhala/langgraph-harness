import type { GraphNode } from '@langchain/langgraph';

import { WorkflowNode } from '#types.js';

import { agent } from '#components/workflows/agent.js';
import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import type { WorkItemResolveAgentConfigurable } from '#components/workflows/state.js';
import { workflowState } from '#components/workflows/work-item-resolve/state.js';

import { config as appConfig } from '#utils/config.js';
import { describeToolCalls } from '#utils/helpers.js';

export const agentNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const {
    projectPath,
    issueNumber,
    issueTitle,
    issueDescription,
    issueType,
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
  } = config.configurable as Partial<WorkItemResolveAgentConfigurable>;
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
        taskTitle: issueTitle,
        taskDescription: issueDescription,
        taskType: issueType,
        repoInstructions,
        taskSource: `implementing a ${host.name} issue`,
        identifiers: host.issueIdentifiers(projectPath, issueNumber),
        extraBlocks: [
          `Call ${describeToolCalls(host.discussion.issueComments)} before starting work — someone may have added detail or a correction as a comment on the issue instead of editing its description, and comments can land there at any point, not just when resuming on an existing ${host.codeChangeRequestName}.`,
        ],
        host,
        model,
        sandbox,
        workingDirectory,
        worktreePath,
        repoKey: host.repoKey(projectPath),
        issueNumber,
        codeChangeRequestNumber: codeChangeRequestNumber ?? null,
        threadId,
        workflow: 'work-item-resolve',
        recursionLimit: appConfig.workItemResolve.recursionLimit,
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
