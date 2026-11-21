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

import { config } from '#utils/config.js';
import { parseRepoKey } from '#utils/git-host.js';
import { fetchReviewThreadTarget } from '#utils/github.js';
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

const githubPullRequestMatches = (args: ToolArgs, target: RunTarget) =>
  githubRepoMatches(args, target) &&
  String(args.pullNumber) === target.codeChangeRequestNumber;

const gitlabMergeRequestMatches = (args: ToolArgs, target: RunTarget) =>
  samePath(decodeURIComponent(String(args.project_id)), target.projectPath) &&
  String(args.merge_request_iid) === target.codeChangeRequestNumber;

// The identifiers in the prompt are only a hint, so a prompt-injected issue, comment or diff could otherwise point a write at any repo the bot token reaches.
const targetMatches: Record<
  string,
  (args: ToolArgs, target: RunTarget) => boolean | Promise<boolean>
> = {
  // A pull request's conversation comments are issue comments on GitHub, so its number is a valid target too.
  [mcpToolName(GitProvider.GitHub, 'add_issue_comment')]: (args, target) =>
    githubRepoMatches(args, target) &&
    [target.issueNumber, target.codeChangeRequestNumber].includes(
      String(args.issue_number),
    ),
  [mcpToolName(GitProvider.GitHub, 'add_reply_to_pull_request_comment')]:
    githubPullRequestMatches,
  [mcpToolName(GitProvider.GitHub, 'add_comment_to_pending_review')]:
    githubPullRequestMatches,
  [mcpToolName(GitProvider.GitHub, 'pull_request_review_write')]: async (
    args,
    target,
  ) => {
    if (!githubPullRequestMatches(args, target)) return false;
    if (
      config.mock.workflow ||
      (args.method !== 'resolve_thread' && args.method !== 'unresolve_thread')
    )
      return true;
    // The server ignores owner/repo/pullNumber for these and acts on threadId alone.
    const thread = await fetchReviewThreadTarget(String(args.threadId)).catch(
      () => undefined,
    );
    return (
      !!thread &&
      samePath(thread.projectPath, target.projectPath) &&
      String(thread.prNumber) === target.codeChangeRequestNumber
    );
  },
  ...Object.fromEntries(
    [
      'create_merge_request_discussion_note',
      'create_draft_note',
      'bulk_publish_draft_notes',
      'publish_draft_note',
      'approve_merge_request',
      'unapprove_merge_request',
      'resolve_merge_request_thread',
    ].map((tool) => [
      mcpToolName(GitProvider.GitLab, tool),
      gitlabMergeRequestMatches,
    ]),
  ),
};

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
      // A write tool with no rule here is refused rather than let through unchecked.
      if (await targetMatches[name]?.(args as ToolArgs, target))
        return handler(request);

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
        input: (args as ToolArgs) ?? {},
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
