import type { GraphNode } from '@langchain/langgraph';

import { GitProvider, WorkflowNode } from '#types.js';

import { agent } from '#components/workflows/agent.js';
import {
  describeToolCall,
  discussionToolsFor,
} from '#components/workflows/discussion-tools.js';
import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';
import type { WorkItemResolveAgentConfigurable } from '#components/workflows/state.js';
import { workflowState } from '#components/workflows/work-item-resolve/state.js';

import { config as appConfig } from '#utils/config.js';
import { forgeFor, repoKey } from '#utils/forge.js';

const ISSUE_IDENTIFIERS: Record<
  GitProvider,
  (projectPath: string, issueIid: string) => string
> = {
  [GitProvider.GitLab]: (projectPath, issueIid) =>
    `project_id "${projectPath}", issue_iid ${issueIid}`,
  [GitProvider.GitHub]: (projectPath, issueIid) => {
    const [owner, repo] = projectPath.split('/');
    return `owner "${owner}", repo "${repo}", issue_number ${issueIid}`;
  },
};

export const agentNode: GraphNode<typeof workflowState> = async (
  state,
  config,
) => {
  const {
    provider,
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
        taskSource: `implementing a ${forgeFor(provider).name} issue`,
        identifiers: ISSUE_IDENTIFIERS[provider](projectPath, issueIid),
        extraBlocks: [
          `Call ${describeToolCall(discussionToolsFor(provider).issueComments)} before starting work — someone may have added detail or a correction as a comment on the issue instead of editing its description, and comments can land there at any point, not just when resuming on an existing ${forgeFor(provider).mrName}.`,
        ],
        provider,
        model,
        sandbox,
        workingDirectory,
        worktreePath,
        projectId: repoKey(provider, projectPath),
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
