import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  tool,
  type ToolRuntime,
} from '@langchain/core/tools';
import { createAgent } from 'langchain';
import z from 'zod';

import type { AgentPromptEvent, SubagentErrorEvent } from '#types.js';

import { createMemoryCandidateTool } from '#components/memories/tool.js';
import { gitService } from '#components/repositories/service.js';
import { gitlabMcp } from '#components/workflows/gitlab-mcp.js';
import {
  contextUsageMiddleware,
  duplicateCallGuardMiddleware,
  llmBackendLimiterMiddleware,
  modelRetryMiddleware,
  noToolCallGuardMiddleware,
  toolOutputCapMiddleware,
  trailingQuestionGuardMiddleware,
} from '#components/workflows/middlewares/index.js';
import {
  createTranslateState,
  translateChunk,
} from '#components/workflows/stream-translator.js';
import type {
  VerifierAgentConfigurable,
  WorkflowConfigurable,
} from './state.js';

import { llms } from '#utils/config.js';
import {
  findRepeatedText,
  generationLoopReason,
  IDLE_TOOL_CALL_MS,
  REPEATED_TEXT_THRESHOLD,
} from '#utils/generation-loop.js';
import { mcpToolFilter, mcpToolName, messageContent } from '#utils/helpers.js';
import { buildChatModel } from '#utils/llm.js';
import { logger } from '#utils/logger.js';
import { resolveWithinWorktree } from '#utils/worktree-path.js';

// fileURLToPath (not URL.pathname) — on Windows the latter yields "/D:/...", which resolve() mangles into a doubled drive prefix ("D:\D:\...").
const skillsPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../skills',
);

type GitToolRuntime = ToolRuntime<unknown, unknown> & {
  configurable?: Partial<WorkflowConfigurable>;
};

const diffFragmentsPath = join(skillsPath, 'gitlab-mcp/diff-fragments');

const loadSkill = tool(
  async ({ path: skillPath }, runtime: GitToolRuntime) => {
    try {
      let content = await readFile(
        join(skillsPath, `${skillPath}.md`),
        'utf-8',
      );

      // code-review.md's diff steps are toolset-dependent — splice in the fragment matching what dynamicDiffToolsMiddleware actually bound this run.
      if (skillPath === 'gitlab-mcp/code-review') {
        const variant = runtime.configurable?.revived ? 'gitlab' : 'local';
        const variantPath = join(diffFragmentsPath, variant);
        const [changedFilesStep, diffStep] = await Promise.all([
          readFile(join(variantPath, 'changed-files.md'), 'utf-8'),
          readFile(join(variantPath, 'diff.md'), 'utf-8'),
        ]);

        content = content
          .replace('{{CHANGED_FILES_STEP}}', changedFilesStep.trim())
          .replace('{{DIFF_STEP}}', diffStep.trim());
      }

      return { content };
    } catch (err) {
      logger.error({ err }, `Error loading skill from path ${skillPath}`);

      return {
        error: `Skill not found: ${skillPath}. Available skills: gitlab-mcp/code-review`,
      };
    }
  },
  {
    name: 'load_skill',
    description:
      'Load step-by-step workflow instructions from a skill file. Call this first when you need guidance on how to perform a specific workflow. Available skills: gitlab-mcp/code-review',
    schema: z.object({
      path: z
        .string()
        .describe(
          'Skill path without .md extension, e.g. "gitlab-mcp/code-review"',
        ),
    }),
  },
);

const createMemoryCandidate = createMemoryCandidateTool<WorkflowConfigurable>({
  description:
    'Flag a durable, repo-specific fact worth remembering for future reviews of this repository — a coding convention, a recurring false positive, a team preference surfaced in discussion, or an architectural decision.',
  buildSource: (configurable) => ({
    workflow: 'code-review',
    mrIid: configurable.mrIid ?? '',
  }),
});

// base = merge-base(source, target) unless overridden, head = source: the net change of the MR, not the moving target branch.
async function diffRange(
  config: WorkflowConfigurable,
  input: { base?: string },
  signal?: AbortSignal,
) {
  const base =
    input.base ??
    (await gitService.mergeBase(
      config.worktreePath,
      config.sourceBranch,
      config.targetBranch,
      signal,
    ));

  return { path: config.worktreePath, base, head: config.sourceBranch };
}

const diffRangeSchema = z.object({
  base: z
    .string()
    .optional()
    .describe(
      "Optional sha to diff from instead of the merge-base — e.g. a prior version's head_commit_sha (list_merge_request_versions) to scope the diff to what changed since that round.",
    ),
});

const gitChangedFiles = tool(
  async (input, runtime: GitToolRuntime) => {
    try {
      const { path, base, head } = await diffRange(
        runtime.configurable as WorkflowConfigurable,
        input,
        runtime.signal,
      );
      return {
        files: await gitService.changedFiles(path, base, head, runtime.signal),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'git_changed_files',
    description:
      'The authoritative list of files this MR changes (name + status), diffed against the merge-base with the target branch. Start here to scope the change.',
    schema: diffRangeSchema,
  },
);

// Full-MR diffs can be tens of thousands of lines (lockfiles, generated code) — cap and let git_file_diff cover whatever gets cut.
const MAX_DIFF_LINES = 2000;

// Splits on `diff --git` boundaries so the cap never lands mid-hunk; the first file is always kept even if it alone exceeds the cap.
function capDiffByFile(
  diff: string,
  maxLines: number,
): { diff: string; omittedFiles: string[] } {
  const fileDiffs = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const kept: string[] = [];
  const omittedFiles: string[] = [];
  let lineCount = 0;

  for (const fileDiff of fileDiffs) {
    const path =
      fileDiff.match(/^diff --git a\/.+ b\/(.+)$/m)?.[1] ?? 'unknown file';
    const lines = fileDiff.split('\n').length;

    if (kept.length > 0 && lineCount + lines > maxLines) {
      omittedFiles.push(path);
      continue;
    }
    if (kept.length === 0 && lines > maxLines) {
      // This one file alone blows the cap — keep a line-level preview of it and still flag it for git_file_diff.
      kept.push(fileDiff.split('\n').slice(0, maxLines).join('\n'));
      omittedFiles.push(path);
      lineCount = maxLines;
      continue;
    }

    kept.push(fileDiff);
    lineCount += lines;
  }

  return { diff: kept.join(''), omittedFiles };
}

const gitDiff = tool(
  async (input, runtime: GitToolRuntime) => {
    try {
      const { path, base, head } = await diffRange(
        runtime.configurable as WorkflowConfigurable,
        input,
        runtime.signal,
      );
      const fullDiff = await gitService.diff(path, base, head, runtime.signal);
      const { diff, omittedFiles } = capDiffByFile(fullDiff, MAX_DIFF_LINES);

      return omittedFiles.length
        ? {
            diff,
            truncated: `Capped at ${MAX_DIFF_LINES} lines — call git_file_diff for the full diff of: ${omittedFiles.join(', ')}.`,
          }
        : { diff };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'git_diff',
    description:
      "The MR's full patch, diffed against the merge-base with the target branch (net change, not per-commit), capped at large sizes. A capped result names the files it had to leave out — fetch those individually with git_file_diff instead of retrying git_diff. Read surrounding code with the filesystem tools for context the patch omits — callers, callees, shared helpers.",
    schema: diffRangeSchema,
  },
);

const gitFileDiff = tool(
  async (input, runtime: GitToolRuntime) => {
    try {
      const { path, base, head } = await diffRange(
        runtime.configurable as WorkflowConfigurable,
        input,
        runtime.signal,
      );
      return {
        diff: await gitService.fileDiff(
          path,
          base,
          head,
          input.path,
          runtime.signal,
        ),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'git_file_diff',
    description:
      "One file's patch, diffed against the merge-base with the target branch. Use this for a file git_diff's truncated notice named, or to re-check a single file's change without re-fetching the whole MR.",
    schema: diffRangeSchema.extend({
      path: z
        .string()
        .describe(
          'File path relative to the repo root, from git_changed_files or a git_diff truncated notice',
        ),
    }),
  },
);

function worktreeOf(runtime: GitToolRuntime): string {
  return (runtime.configurable as WorkflowConfigurable).worktreePath;
}

const MAX_READ_LINES = 300;

const readTextFile = tool(
  async ({ path, offset, limit }, runtime: GitToolRuntime) => {
    try {
      const abs = await resolveWithinWorktree(worktreeOf(runtime), path);
      const raw = await readFile(abs, 'utf-8');
      const lines = raw.split('\n');
      if (offset == null && limit == null && lines.length <= MAX_READ_LINES) {
        return { content: raw };
      }

      // Windowed (or capped) read: number lines so they line up with git_grep's file:line matches.
      const start = Math.max((offset ?? 1) - 1, 0);
      const requestedEnd = limit != null ? start + limit : lines.length;
      const end = Math.min(requestedEnd, start + MAX_READ_LINES);
      const content = lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}\t${line}`)
        .join('\n');

      return end < requestedEnd
        ? {
            content,
            truncated: `Capped at ${MAX_READ_LINES} lines — call again with offset: ${end + 1} to continue.`,
          }
        : { content };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'read_text_file',
    description:
      'Read a UTF-8 text file from the checked-out worktree, path relative to the repo root (e.g. "src/api.ts"). Read the code around a change — callers, callees, shared helpers — that the diff alone omits. Run git_grep first and pass its file:line match as offset — do not read a whole file unscoped unless you already know it\'s short. Reads over 300 lines come back capped — page through with offset.',
    schema: z.object({
      path: z.string().describe('File path relative to the repo root'),
      offset: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          '1-indexed line to start reading from (e.g. a git_grep match); omit to read from the top',
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max lines to read from offset; omit to read to the end'),
    }),
  },
);

const readMultipleFiles = tool(
  async ({ paths }, runtime: GitToolRuntime) => {
    const root = worktreeOf(runtime);
    const files = await Promise.all(
      paths.map(async (path) => {
        try {
          const abs = await resolveWithinWorktree(root, path);
          const raw = await readFile(abs, 'utf-8');
          const lines = raw.split('\n');
          if (lines.length <= MAX_READ_LINES) return { path, content: raw };

          // Windowed from the top, numbered so it lines up with git_grep's file:line matches — same convention as read_text_file.
          const content = lines
            .slice(0, MAX_READ_LINES)
            .map((line, i) => `${i + 1}\t${line}`)
            .join('\n');

          return {
            path,
            content,
            truncated: `Capped at ${MAX_READ_LINES} lines — call read_text_file on this path with offset: ${MAX_READ_LINES + 1} to continue.`,
          };
        } catch (err) {
          return {
            path,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    return { files };
  },
  {
    name: 'read_multiple_files',
    description:
      "Read several text files at once, each path relative to the repo root. Prefer this over repeated read_text_file calls when tracing one change across files (a helper plus its callers) — git_grep is how you find those files in the first place. Each file over 300 lines comes back capped from the top — page through a specific one with read_text_file's offset instead.",
    schema: z.object({
      paths: z
        .array(z.string())
        .describe('File paths relative to the repo root'),
    }),
  },
);

const MAX_TREE_DEPTH = 4;

type DirNode = { path: string; type: 'dir' | 'file'; children?: DirNode[] };

async function listDir(
  root: string,
  rel: string,
  depth: number,
): Promise<DirNode[]> {
  const abs = await resolveWithinWorktree(root, rel || '.');
  const entries = await readdir(abs, { withFileTypes: true });
  const nodes: DirNode[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const childRel = rel
      ? `${rel.replace(/\/$/, '')}/${entry.name}`
      : entry.name;
    const isDir = entry.isDirectory();
    const node: DirNode = { path: childRel, type: isDir ? 'dir' : 'file' };
    if (isDir && depth > 1)
      node.children = await listDir(root, childRel, depth - 1);
    nodes.push(node);
  }

  return nodes;
}

const listDirectory = tool(
  async ({ path = '.', depth = 1 }, runtime: GitToolRuntime) => {
    try {
      const clampedDepth = Math.min(Math.max(depth, 1), MAX_TREE_DEPTH);
      const entries = await listDir(
        worktreeOf(runtime),
        path === '.' ? '' : path,
        clampedDepth,
      );
      return { entries };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'list_directory',
    description:
      'List a directory in the worktree, path relative to the repo root ("." for the root). Set depth 1–4 (default 1) to recurse. Orient yourself in the repo layout before reading files.',
    schema: z.object({
      path: z
        .string()
        .default('.')
        .describe('Directory relative to the repo root; "." for the root'),
      depth: z
        .number()
        .int()
        .optional()
        .describe('Recursion depth, 1–4 (default 1)'),
    }),
  },
);

// A broad pattern (common identifier, short string) can return thousands of matches — cap and push the model to narrow instead of reading past it.
const MAX_GREP_LINES = 500;

const gitGrep = tool(
  async ({ pattern, path, context, fixed }, runtime: GitToolRuntime) => {
    try {
      const output = await gitService.grep(
        worktreeOf(runtime),
        pattern,
        path,
        context,
        runtime.signal,
        fixed,
      );
      if (!output) return { matches: 'No matches.' };

      const lines = output.split('\n');
      if (lines.length <= MAX_GREP_LINES) return { matches: output };

      return {
        matches: lines.slice(0, MAX_GREP_LINES).join('\n'),
        truncated: `Capped at ${MAX_GREP_LINES} lines — narrow with path or a more specific pattern instead of reading past this.`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'git_grep',
    description:
      "Search file contents across the worktree (git grep), returning file:line:text matches, capped at large result sets. This is how you find where something is used or defined — callers of a changed function, other references to a changed symbol, similar patterns elsewhere. Start here before reading a file cold; feed a match's line number into read_text_file's offset instead of reading the whole file. A capped result is a signal to narrow with path or a more specific pattern, not to page through.",
    schema: z.object({
      pattern: z
        .string()
        .describe(
          'Text or POSIX basic regex (BRE) to search for. In BRE, "(" and ")" are literal — do not escape parens to search for literal ones; "\\(" and "\\)" instead open/close a group. If unsure, or copying an exact snippet from source, set fixed: true instead of hand-escaping it.',
        ),
      path: z
        .string()
        .optional()
        .describe(
          'Optional pathspec (file or dir) to scope the search, relative to the repo root. A directory recurses into every file beneath it, so an uncapped result already covers its children — re-running the same pattern scoped to one of those children returns nothing new.',
        ),
      context: z
        .number()
        .int()
        .min(0)
        .max(20)
        .optional()
        .describe(
          'Lines of context to include before/after each match (git grep -C); omit for match lines only',
        ),
      fixed: z
        .boolean()
        .optional()
        .describe(
          'Set true to match pattern as literal text (git grep --fixed-strings) instead of a regex. Use this for an exact snippet copied from source; leave unset only for genuine regex features like alternation ("useState|useEffect") or anchors ("^import").',
        ),
    }),
  },
);

const VERIFIER_SYSTEM_PROMPT =
  `You verify whether one specific file's change in a merge request is safe. ` +
  `You are given the file path and its diff — do not re-fetch it. Read ` +
  `surrounding code with your tools (callers, callees, shared helpers) to ` +
  `judge whether the change is correct and safe, the same way a careful ` +
  `reviewer would before approving it.\n\n` +
  `Report back only concrete findings: for each concern, state what's wrong, ` +
  `the evidence (file/line, call site), and why it matters. If nothing is ` +
  `wrong, say so plainly — do not invent hedges or speculative concerns to ` +
  `have something to report.`;

const VERIFIER_TOOLS = [
  gitGrep,
  readTextFile,
  readMultipleFiles,
  listDirectory,
];

type CompiledVerifier = ReturnType<typeof createAgent>;

// Bounded by config.llms x reasoning (2) — no eviction needed, same as the reviewer agent's own cache.
const verifierCache = new Map<string, CompiledVerifier>();

function buildVerifier(model: string, reasoning: boolean): CompiledVerifier {
  const modelConfig = llms.find((m) => m.model === model);

  if (!modelConfig) {
    throw new Error(`Unknown model: ${model}`);
  }

  const llm = buildChatModel(modelConfig, reasoning);
  const messageTokenCache = new WeakMap();

  return createAgent({
    model: llm,
    tools: VERIFIER_TOOLS,
    systemPrompt: VERIFIER_SYSTEM_PROMPT,
    // Same relative ordering as the reviewer agent's middleware stack (agent.ts): toolOutputCap outermost of the wrapToolCall group, duplicateCallGuard before noToolCallGuard, contextUsage/llmBackendLimiter innermost.
    middleware: [
      modelRetryMiddleware({ maxRetries: 3 }),
      toolOutputCapMiddleware(),
      duplicateCallGuardMiddleware({
        readToolNames: new Set(VERIFIER_TOOLS.map((t) => t.name)),
      }),
      noToolCallGuardMiddleware({
        message:
          "You're concluding without having called a single tool. If the " +
          'change is genuinely trivial enough to judge from the diff alone, ' +
          'say so — otherwise investigate before reporting.',
      }),
      trailingQuestionGuardMiddleware(),
      contextUsageMiddleware(modelConfig, messageTokenCache),
      llmBackendLimiterMiddleware(modelConfig),
    ],
  });
}

function getVerifier(model: string, reasoning: boolean): CompiledVerifier {
  const key = `${model}:${reasoning}`;
  let verifier = verifierCache.get(key);
  if (!verifier) {
    verifier = buildVerifier(model, reasoning);
    verifierCache.set(key, verifier);
  }
  return verifier;
}

const spawnSubagent = tool(
  async ({ path, diff, instructions }, runtime: GitToolRuntime) => {
    // Scoped to this call — a loop detected below aborts only this subagent, not the run.
    const subagentController = new AbortController();
    // Manual relay, not AbortSignal.any(runtime.signal, ...) — that pins a listener on the long-lived run signal until the run ends.
    const onRunAbort = () => subagentController.abort(runtime.signal!.reason);
    runtime.signal?.addEventListener('abort', onRunAbort, { once: true });
    try {
      const { model, reasoning, worktreePath } =
        runtime.configurable as WorkflowConfigurable;
      const verifier = getVerifier(model, reasoning);
      const task = [
        `File: ${path}`,
        `Diff:\n${diff}`,
        instructions && `Specific concern to focus on: ${instructions}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      runtime.writer?.({
        event: 'agent_prompt',
        data: {
          id: crypto.randomUUID(),
          systemPrompt: VERIFIER_SYSTEM_PROMPT,
          humanMessage: task,
          subagentId: runtime.toolCallId,
          timestamp: Date.now(),
        },
      } satisfies AgentPromptEvent);

      const stream = await verifier.stream(
        { messages: [new HumanMessage(task)] },
        {
          signal: subagentController.signal,
          // Ambient callback inheritance (Node's AsyncLocalStorage) would otherwise leak the Verifier's raw tool/message activity into the main agent's own 'tools'/'messages' streams, untagged — we re-translate and re-tag them ourselves below instead.
          callbacks: [],
          streamMode: ['messages', 'tools', 'custom', 'values'],
          configurable: {
            worktreePath,
            subagentId: runtime.toolCallId,
            toolCallCounts: new Map(),
            toolErrorCounts: new Map(),
            trailingQuestionNudged: { nudged: false },
            toolCallMade: { called: false },
            noToolCallNudged: { nudged: false },
          } satisfies VerifierAgentConfigurable,
        },
      );

      // No lc_source-tagged internal calls exist in the Verifier's own middleware stack (it drops summarizeContext/commentCritic/extractProjectMemory), so nothing to recognize here.
      const translateState = createTranslateState();
      let lastState: { messages: BaseMessage[] } | undefined;
      // Local mirror of runs/service.ts's watchdog, scoped to just this call's messages.
      const messageContents = new Map<
        string,
        { content: string; reasoningContent: string }
      >();
      let lastProgressAt = Date.now();
      for await (const [mode, chunk] of stream) {
        if (mode === 'values') {
          lastState = chunk as { messages: BaseMessage[] };
          continue;
        }

        for (const event of translateChunk(
          mode,
          chunk,
          translateState,
          new Set(),
          runtime.toolCallId,
        )) {
          runtime.writer?.(event);

          if (event.event === 'tool_input') lastProgressAt = Date.now();

          if (event.event === 'message') {
            const existing = messageContents.get(event.data.id) ?? {
              content: '',
              reasoningContent: '',
            };
            const updated = {
              content: existing.content + event.data.content,
              reasoningContent:
                existing.reasoningContent + event.data.reasoningContent,
            };
            messageContents.set(event.data.id, updated);

            if (Date.now() - lastProgressAt >= IDLE_TOOL_CALL_MS) {
              // A loop can play out entirely inside the reasoning stream, so both fields need the same scan.
              const repeated =
                findRepeatedText(updated.content, REPEATED_TEXT_THRESHOLD) ??
                findRepeatedText(
                  updated.reasoningContent,
                  REPEATED_TEXT_THRESHOLD,
                );
              if (repeated) {
                subagentController.abort(
                  new DOMException(
                    generationLoopReason(repeated),
                    'GenerationLoopError',
                  ),
                );
              }
            }
          }
        }
      }

      const last = lastState?.messages[lastState.messages.length - 1];
      return { findings: last ? messageContent(last.content) : '' };
    } catch (err) {
      const error = subagentController.signal.aborted
        ? (subagentController.signal.reason as DOMException).message
        : err instanceof Error
          ? err.message
          : String(err);
      runtime.writer?.({
        event: 'subagent_error',
        data: {
          id: crypto.randomUUID(),
          error,
          subagentId: runtime.toolCallId,
          timestamp: Date.now(),
        },
      } satisfies SubagentErrorEvent);
      return { error };
    } finally {
      runtime.signal?.removeEventListener('abort', onRunAbort);
    }
  },
  {
    name: 'spawn_subagent',
    description:
      "Spawn an isolated verifier for one file's change, so its investigation " +
      "(reading callers, related files, etc.) doesn't fill your own context. " +
      'Give it the file path and its diff — already fetched, do not re-fetch ' +
      'it — and it returns findings only. It cannot post comments or see ' +
      'other files; fold its findings into your own review. Depth-capped: it ' +
      'cannot spawn further sub-agents itself.',
    schema: z.object({
      path: z.string().describe('File path relative to the repo root'),
      diff: z
        .string()
        .describe("The file's diff, already fetched — do not re-fetch it"),
      instructions: z
        .string()
        .optional()
        .describe('Optional specific concern to focus the check on'),
    }),
  },
);

const GIT_READ_TOOLS = new Set([
  gitChangedFiles.name,
  gitDiff.name,
  gitFileDiff.name,
]);

const LOCAL_READ_TOOLS = new Set([
  gitGrep.name,
  readTextFile.name,
  readMultipleFiles.name,
  listDirectory.name,
]);

// Swapped in for GIT_READ_TOOLS on a revived retry (with dynamicDiffToolsMiddleware).
const GITLAB_DIFF_TOOLS = new Set([
  'get_merge_request_diffs',
  'list_merge_request_changed_files',
]);

const MR_READ_TOOLS = new Set([
  // metadata
  'get_merge_request',
  'get_merge_request_conflicts',
  'get_merge_request_approval_state',
  'mr_discussions',
  // push history
  'list_merge_request_versions',
  // review diff
  ...GITLAB_DIFF_TOOLS,
  // review drafting
  'list_draft_notes',
]);

// separate list for mocking
const MR_WRITE_TOOLS = new Set([
  // approval
  'approve_merge_request',
  'unapprove_merge_request',
  // review drafting
  'create_draft_note',
  'bulk_publish_draft_notes',
  'publish_draft_note',
  // resolve threads
  'resolve_merge_request_thread',
]);

// MR-related tools derived from the gitlab-mcp/code-review skill. All others (issues, pipelines, projects, branches, etc.) are excluded to keep the context small.
const MR_TOOL_ALLOWLIST = new Set([...MR_READ_TOOLS, ...MR_WRITE_TOOLS]);

// Fetched for middleware to call directly, outside the model's tool loop
const INTERNAL_TOOLS = new Set([
  'delete_draft_note',
  'mr_discussions',
  'get_merge_request_file_diff',
]);

let mcpTools: DynamicStructuredTool[] = [];
let internalTools = new Map<string, DynamicStructuredTool>();

export const tools = {
  init: async () => {
    // A failed GitLab MCP connection (bad PAT, no network, npx failure) must
    // stop the server from booting — the whole workflow is useless without it.
    const allTools = await gitlabMcp.getTools();
    internalTools = new Map(
      allTools
        .filter(mcpToolFilter(INTERNAL_TOOLS, 'gitlab'))
        .map((t) => [t.name, t]),
    );
    mcpTools = [
      loadSkill,
      createMemoryCandidate,
      gitChangedFiles,
      gitDiff,
      gitFileDiff,
      gitGrep,
      readTextFile,
      readMultipleFiles,
      listDirectory,
      spawnSubagent,
      ...allTools.filter(mcpToolFilter(MR_TOOL_ALLOWLIST, 'gitlab')),
    ];
  },
  getAll: () => mcpTools,
  getMrReadNames: () =>
    mcpTools
      .filter(
        mcpToolFilter(
          new Set([...MR_READ_TOOLS, ...GIT_READ_TOOLS, ...LOCAL_READ_TOOLS]),
          'gitlab',
        ),
      )
      .map((t) => t.name),
  getInternal: (name: string) => internalTools.get(name),
  getDiffToolNames: () => ({
    localToolNames: GIT_READ_TOOLS,
    gitlabToolNames: new Set(
      [...GITLAB_DIFF_TOOLS].map((name) => mcpToolName('gitlab', name)),
    ),
  }),
  getMockableNames: () =>
    mcpTools.filter(mcpToolFilter(MR_WRITE_TOOLS, 'gitlab')).map((t) => t.name),
  cleanup: () => gitlabMcp.close(),
};
