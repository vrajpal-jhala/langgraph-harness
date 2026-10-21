import type { Sandbox } from '@alibaba-group/opensandbox';
import {
  DynamicStructuredTool,
  tool,
  type ToolRuntime,
} from '@langchain/core/tools';
import z from 'zod';

import { GitProvider } from '#types.js';

import { createMemoryCandidateTool } from '#components/memories/tool.js';
import { githubMcp } from '#components/workflows/github-mcp.js';
import { gitlabMcp } from '#components/workflows/gitlab-mcp.js';
import type { SandboxAgentConfigurable } from '#components/workflows/state.js';
import { fetchWebPage } from '#components/workflows/web-fetch.js';

import { config } from '#utils/config.js';
import { mcpToolFilter } from '#utils/helpers.js';

type SandboxToolRuntime = ToolRuntime<unknown, unknown> & {
  configurable?: Partial<SandboxAgentConfigurable>;
};

function sandboxOf(runtime: SandboxToolRuntime): Sandbox {
  return (runtime.configurable as SandboxAgentConfigurable).sandbox;
}

function cwdOf(runtime: SandboxToolRuntime): string {
  return (runtime.configurable as SandboxAgentConfigurable).workingDirectory;
}

const runCommand = tool(
  async (
    { command, workingDirectory, timeoutSeconds },
    runtime: SandboxToolRuntime,
  ) => {
    try {
      const execution = await sandboxOf(runtime).commands.run(
        command,
        {
          workingDirectory: workingDirectory ?? cwdOf(runtime),
          timeoutSeconds,
        },
        undefined,
        runtime.signal,
      );
      return {
        stdout: execution.logs.stdout.map((m) => m.text).join(''),
        stderr: execution.logs.stderr.map((m) => m.text).join(''),
        exitCode: execution.exitCode ?? null,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'run_command',
    description:
      'Run a shell command inside the sandbox (cwd defaults to the repo checkout). Use it for reading, listing, and searching files (cat, ls, grep, find) as well as running builds, tests, and git commands.',
    schema: z.object({
      command: z.string().describe('Shell command to execute'),
      workingDirectory: z
        .string()
        .optional()
        .describe(
          'Absolute path to run the command in; defaults to the repo checkout',
        ),
      timeoutSeconds: z
        .number()
        .int()
        .optional()
        .default(300)
        .describe(
          'Kill the command if it runs longer than this (default 300s) — raise it upfront for a known-long build/install, or retry higher if a command times out',
        ),
    }),
  },
);

const writeFiles = tool(
  async ({ files }, runtime: SandboxToolRuntime) => {
    try {
      const cwd = cwdOf(runtime);
      await sandboxOf(runtime).files.writeFiles(
        files.map((f) => ({
          path: f.path.startsWith('/') ? f.path : `${cwd}/${f.path}`,
          data: f.content,
        })),
      );
      return { written: files.map((f) => f.path) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'write_files',
    description:
      'Write one or more files inside the sandbox, creating or overwriting them. Paths are relative to the repo checkout unless absolute.',
    schema: z.object({
      files: z
        .array(
          z.object({
            path: z
              .string()
              .describe(
                'File path, relative to the repo checkout unless absolute',
              ),
            content: z.string(),
          }),
        )
        .min(1),
    }),
  },
);

const createMemoryCandidate =
  createMemoryCandidateTool<SandboxAgentConfigurable>({
    description:
      'Flag a durable, repo-specific fact worth remembering for future work on this repository — a verified setup/build/test command, a repo convention, or an architectural decision.',
    buildSource: (configurable) =>
      configurable.workflow === 'task-resolve'
        ? { workflow: 'task-resolve', threadId: configurable.threadId }
        : { workflow: 'work-item-resolve', issueIid: configurable.issueIid },
  });

const ISSUE_READ_TOOLS: Record<GitProvider, Set<string>> = {
  [GitProvider.GitLab]: new Set(['mr_discussions', 'list_issue_discussions']),
  [GitProvider.GitHub]: new Set(['issue_read', 'pull_request_read']),
};
const ISSUE_WRITE_TOOLS: Record<GitProvider, Set<string>> = {
  [GitProvider.GitLab]: new Set(['create_merge_request_discussion_note']),
  [GitProvider.GitHub]: new Set([
    'add_issue_comment',
    'add_reply_to_pull_request_comment',
  ]),
};

const providerTools: Record<GitProvider, DynamicStructuredTool[]> = {
  [GitProvider.GitLab]: [],
  [GitProvider.GitHub]: [],
};

const allowedFrom = (
  allTools: DynamicStructuredTool[],
  provider: GitProvider,
) =>
  allTools.filter(
    mcpToolFilter(
      new Set([...ISSUE_READ_TOOLS[provider], ...ISSUE_WRITE_TOOLS[provider]]),
      provider,
    ),
  );

export const tools = {
  init: async () => {
    const baseTools = [
      runCommand,
      writeFiles,
      createMemoryCandidate,
      fetchWebPage,
    ];
    providerTools[GitProvider.GitLab] = [
      ...baseTools,
      ...allowedFrom(await gitlabMcp.getTools(), GitProvider.GitLab),
    ];
    // GitHub is optional — a GitLab-only deployment never opens that connection.
    if (config.github.pat) {
      providerTools[GitProvider.GitHub] = [
        ...baseTools,
        ...allowedFrom(await githubMcp.getTools(), GitProvider.GitHub),
      ];
    }
  },
  getAll: (provider: GitProvider = GitProvider.GitLab) =>
    providerTools[provider],
  getReadNames: (provider: GitProvider = GitProvider.GitLab) =>
    ['run_command', 'fetch_web_page'].concat(
      providerTools[provider]
        .filter(mcpToolFilter(ISSUE_READ_TOOLS[provider], provider))
        .map((t) => t.name),
    ),
  cleanup: async () => {
    await Promise.all([gitlabMcp.close(), githubMcp.close()]);
  },
};
