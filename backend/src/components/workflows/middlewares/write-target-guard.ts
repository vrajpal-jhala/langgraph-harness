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
import { mcpToolName } from '#utils/helpers.js';

type RunTarget = {
  projectPath: string;
  issueIid: string | null;
  mrIid: string | null;
};
type ToolArgs = Record<string, unknown>;

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const githubRepoMatches = (args: ToolArgs, { projectPath }: RunTarget) =>
  samePath(`${args.owner}/${args.repo}`, projectPath);

// The identifiers in the prompt are only a hint, so a prompt-injected issue or comment could otherwise point a write at any repo the bot token reaches.
const targetMatches: Record<
  string,
  (args: ToolArgs, target: RunTarget) => boolean
> = {
  // A pull request's conversation comments are issue comments on GitHub, so its number is a valid target too.
  [mcpToolName(GitProvider.GitHub, 'add_issue_comment')]: (args, target) =>
    githubRepoMatches(args, target) &&
    [target.issueIid, target.mrIid].includes(String(args.issue_number)),
  [mcpToolName(GitProvider.GitHub, 'add_reply_to_pull_request_comment')]: (
    args,
    target,
  ) =>
    githubRepoMatches(args, target) && String(args.pullNumber) === target.mrIid,
  [mcpToolName(GitProvider.GitLab, 'create_merge_request_discussion_note')]: (
    args,
    target,
  ) =>
    samePath(decodeURIComponent(String(args.project_id)), target.projectPath) &&
    String(args.merge_request_iid) === target.mrIid,
};

export function writeTargetGuardMiddleware() {
  return createMiddleware({
    name: 'WriteTargetGuard',
    wrapToolCall: async (request, handler) => {
      const configurable = (request.runtime as SandboxAgentRuntime)
        .configurable;
      const host = configurable?.host;
      const { name, args, id } = request.toolCall;
      const isWrite = [...(host?.issueTools.write ?? [])].some(
        (tool) => host && mcpToolName(host.provider, tool) === name,
      );
      if (!host || !configurable?.projectId || !isWrite)
        return handler(request);

      const target: RunTarget = {
        projectPath: parseRepoKey(configurable.projectId).projectPath,
        issueIid:
          configurable.workflow === 'work-item-resolve'
            ? (configurable.issueIid ?? null)
            : null,
        mrIid: configurable.mrIid ?? null,
      };
      // A write tool with no rule here is refused rather than let through unchecked.
      if (targetMatches[name]?.(args as ToolArgs, target))
        return handler(request);

      const allowed = [
        ...(target.issueIid
          ? [host.issueIdentifiers(target.projectPath, target.issueIid)]
          : [host.repoIdentifiers(target.projectPath)]),
        ...(target.mrIid
          ? [host.codeChangeRequestIdentifier(target.mrIid)]
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
