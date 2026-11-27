import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

import { GitProvider } from '#types.js';

import {
  emitCorrectiveNudgeEndEvent,
  emitCorrectiveNudgeStartEvent,
  emitToolInputEvent,
  emitToolOutputEvent,
} from '#components/workflows/emit.js';
import type { SandboxAgentRuntime } from '#components/workflows/state.js';

import { parseRepoKey } from '#utils/git-host.js';
import { fetchProjectPath } from '#utils/gitlab.js';
import { mcpToolName } from '#utils/helpers.js';

type RunTarget = {
  projectPath: string;
  issueNumber: string | null;
  codeChangeRequestNumber: string | null;
};
type ToolArgs = Record<string, unknown>;

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const githubRepoMatches = (args: ToolArgs, { projectPath }: RunTarget) =>
  samePath(`${args.owner}/${args.repo}`, projectPath);

const gitlabMergeRequestMatches = (args: ToolArgs, target: RunTarget) =>
  samePath(decodeURIComponent(String(args.project_id)), target.projectPath) &&
  String(args.merge_request_iid) === target.codeChangeRequestNumber;

const gitlabMergeRequestTools = new Set(
  [
    'create_merge_request_discussion_note',
    'create_draft_note',
    'bulk_publish_draft_notes',
    'publish_draft_note',
    'approve_merge_request',
    'unapprove_merge_request',
    'resolve_merge_request_thread',
  ].map((tool) => mcpToolName(GitProvider.GitLab, tool)),
);

// The identifiers in the prompt are only a hint, so a prompt-injected issue, comment or diff could otherwise point a write at any repo the bot token reaches.
const targetMatches: Record<
  string,
  (args: ToolArgs, target: RunTarget) => boolean
> = {
  // A pull request's conversation comments are issue comments on GitHub, so its number is a valid target too.
  [mcpToolName(GitProvider.GitHub, 'add_issue_comment')]: (args, target) =>
    githubRepoMatches(args, target) &&
    [target.issueNumber, target.codeChangeRequestNumber].includes(
      String(args.issue_number),
    ),
  [mcpToolName(GitProvider.GitHub, 'add_reply_to_pull_request_comment')]: (
    args,
    target,
  ) =>
    githubRepoMatches(args, target) &&
    String(args.pullNumber) === target.codeChangeRequestNumber,
  ...Object.fromEntries(
    [...gitlabMergeRequestTools].map((tool) => [
      tool,
      gitlabMergeRequestMatches,
    ]),
  ),
};

// The run's own MR is the only target the guard allows, so missing IDs can only mean that one, and a numeric project_id is checked by its path.
async function withGitlabTarget(
  args: ToolArgs,
  target: RunTarget,
): Promise<ToolArgs> {
  const projectId = String(args.project_id ?? target.projectPath);
  return {
    ...args,
    project_id: /^\d+$/.test(projectId)
      ? await fetchProjectPath(projectId).catch(() => projectId)
      : projectId,
    merge_request_iid:
      args.merge_request_iid ?? target.codeChangeRequestNumber ?? undefined,
  };
}

export function writeTargetGuardMiddleware(writeToolNames: Set<string>) {
  return createMiddleware({
    name: 'WriteTargetGuard',
    wrapToolCall: async (request, handler) => {
      const configurable = (request.runtime as SandboxAgentRuntime)
        .configurable;
      const host = configurable?.host;
      const { name, args, id } = request.toolCall;
      if (!host || !configurable?.repoKey || !writeToolNames.has(name))
        return handler(request);

      const target: RunTarget = {
        projectPath: parseRepoKey(configurable.repoKey).projectPath,
        issueNumber:
          configurable.workflow === 'work-item-resolve'
            ? (configurable.issueNumber ?? null)
            : null,
        codeChangeRequestNumber: configurable.codeChangeRequestNumber ?? null,
      };
      const toolArgs = gitlabMergeRequestTools.has(name)
        ? await withGitlabTarget(args as ToolArgs, target)
        : (args as ToolArgs);
      // A write tool with no rule here is refused rather than let through unchecked.
      if (targetMatches[name]?.(toolArgs, target))
        return handler({
          ...request,
          toolCall: { ...request.toolCall, args: toolArgs },
        });

      const allowed = [
        ...(target.issueNumber
          ? [host.issueIdentifiers(target.projectPath, target.issueNumber)]
          : [host.repoIdentifiers(target.projectPath)]),
        ...(target.codeChangeRequestNumber
          ? [host.codeChangeRequestIdentifier(target.codeChangeRequestNumber)]
          : []),
      ].join(', ');
      const content = `Rejected: \`${name}\` can only write to this run's own target (${allowed}). Call it with those identifiers, or don't post.`;
      // handler() never runs, so the timeline's tool events have to be sent by hand.
      emitToolInputEvent(request.runtime, {
        id: id ?? '',
        name,
        input: toolArgs,
      });
      emitToolOutputEvent(request.runtime, {
        id: id ?? '',
        output: JSON.stringify({ error: content }),
      });
      const nudgeId = crypto.randomUUID();
      emitCorrectiveNudgeStartEvent(request.runtime, {
        id: nudgeId,
        middleware: 'WriteTargetGuard',
        prompt: content,
      });
      emitCorrectiveNudgeEndEvent(request.runtime, { id: nudgeId, error: '' });
      return new ToolMessage({
        content,
        tool_call_id: id ?? '',
        status: 'error',
      });
    },
  });
}
