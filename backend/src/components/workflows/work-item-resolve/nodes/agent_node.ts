import type { GraphNode } from '@langchain/langgraph';

import { WorkflowNode } from '#types.js';

import { agent } from '#components/workflows/agent.js';
import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import type { WorkItemResolveAgentConfigurable } from '#components/workflows/state.js';
import { workflowState } from '#components/workflows/work-item-resolve/state.js';

import { config as appConfig } from '#utils/config.js';
import { mcpToolName } from '#utils/helpers.js';

const LIST_ISSUE_DISCUSSIONS_TOOL = mcpToolName(
  'gitlab',
  'list_issue_discussions',
);

export const agentNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const {
    projectPath,
    issueIid,
    issueTitle,
    issueDescription,
    issueType,
    model,
    messages,
    config: workflowConfig,
  } = state;
  const repoInstructions = workflowConfig.instructions.content;
  const { signal } = config;
  const { sandbox, workingDirectory, worktreePath, mrIid } =
    config.configurable as Partial<WorkItemResolveAgentConfigurable>;
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
        taskTitle: issueTitle,
        taskDescription: issueDescription,
        taskType: issueType,
        repoInstructions,
        taskSource: 'implementing a GitLab issue',
        identifiers: `project_id "${projectPath}", issue_iid ${issueIid}`,
        extraBlocks: [
          `Call \`${LIST_ISSUE_DISCUSSIONS_TOOL}\` before starting work — someone may have added detail or a correction as a comment on the issue instead of editing its description, and comments can land there at any point, not just when resuming on an existing MR.`,
        ],
        model,
        sandbox,
        workingDirectory,
        worktreePath,
        projectId: projectPath,
        issueIid,
        mrIid: mrIid ?? null,
        threadId,
        workflow: 'work-item-resolve',
        recursionLimit: appConfig.workItemResolve.recursionLimit,
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
