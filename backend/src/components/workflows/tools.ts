import type { Sandbox } from '@alibaba-group/opensandbox';
import {
  DynamicStructuredTool,
  tool,
  type ToolRuntime,
} from '@langchain/core/tools';
import z from 'zod';

import { createMemoryCandidateTool } from '#components/memories/tool.js';
import { gitlabMcp } from '#components/workflows/gitlab-mcp.js';
import type { SandboxAgentConfigurable } from '#components/workflows/state.js';
import { fetchWebPage } from '#components/workflows/web-fetch.js';

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

const ISSUE_READ_TOOLS = new Set(['mr_discussions', 'list_issue_discussions']);
const ISSUE_WRITE_TOOLS = new Set(['create_merge_request_discussion_note']);
const ISSUE_TOOL_ALLOWLIST = new Set([
  ...ISSUE_READ_TOOLS,
  ...ISSUE_WRITE_TOOLS,
]);

let mcpTools: DynamicStructuredTool[] = [];

export const tools = {
  init: async () => {
    const allTools = await gitlabMcp.getTools();
    mcpTools = [
      runCommand,
      writeFiles,
      createMemoryCandidate,
      fetchWebPage,
      ...allTools.filter(mcpToolFilter(ISSUE_TOOL_ALLOWLIST, 'gitlab')),
    ];
  },
  getAll: () => mcpTools,
  getReadNames: () =>
    ['run_command', 'fetch_web_page'].concat(
      mcpTools
        .filter(mcpToolFilter(ISSUE_READ_TOOLS, 'gitlab'))
        .map((t) => t.name),
    ),
  cleanup: () => gitlabMcp.close(),
};
