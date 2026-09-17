import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import {
  type DynamicStructuredTool,
  tool,
  type ToolRuntime,
} from '@langchain/core/tools';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import puppeteer, { type Browser, type BrowserContext } from 'puppeteer-core';
import { z } from 'zod';

import {
  MEMORY_CATEGORIES,
  type MemoryCategory,
  RunKind,
  RunStatus,
  type SearchMode,
} from '#types.js';

import { memoriesDal } from '#components/memories/dal.js';
import { runsDal } from '#components/runs/dal.js';
import { threadsDal } from '#components/threads/dal.js';
import { buildFetchWebPageTool } from '#components/workflows/web-fetch.js';
import type { ChatToolContext } from './state.js';

import { config, supermemoryProjects } from '#utils/config.js';
import { logger } from '#utils/logger.js';

const searchModeSchema = z
  .enum(['substring', 'regex', 'fuzzy'])
  .optional()
  .describe(
    "Match style: 'substring' (default, literal text anywhere), 'regex' (case-insensitive POSIX regex), or 'fuzzy' (typo-tolerant similarity).",
  );

const CONTENT_SNIPPET_RADIUS = 80;
const CONTENT_SNIPPET_RADIUS_MAX = 2000;

const snippetControlSchema = {
  radius: z
    .number()
    .min(20)
    .max(CONTENT_SNIPPET_RADIUS_MAX)
    .optional()
    .default(CONTENT_SNIPPET_RADIUS)
    .describe(
      'Characters of context around the match. Widen this if the default snippet cuts off the part you need.',
    ),
  full: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Return the full matched input+events JSON instead of a snippet — overrides radius. Use when you need the complete message, not a preview.',
    ),
};

const queryProjectMemoriesSchema = z.object({
  projectId: z
    .string()
    .optional()
    .describe(
      'GitLab project path (e.g. group/repo). Omit for a per-project count overview.',
    ),
  categories: z
    .array(z.enum(MEMORY_CATEGORIES as [string, ...string[]]))
    .optional(),
});

// Read-only view over the project memories the MR-review workflow accumulates.
const queryProjectMemories = tool(
  async ({ projectId, categories }) => {
    if (!projectId) return { counts: await memoriesDal.countsByProject() };
    return {
      memories: await memoriesDal.listByProject(
        projectId,
        categories as MemoryCategory[] | undefined,
      ),
    };
  },
  {
    name: 'query_project_memories',
    description:
      "Inspect harness's stored per-project review memories. With a projectId, returns that project's memories (optionally filtered by category); without one, returns memory counts per project.",
    schema: queryProjectMemoriesSchema,
  },
);

interface SupermemorySearchResult {
  memory: string;
  similarity: number;
  metadata: Record<string, string> | null;
}

const listProjects = tool(
  async () => ({
    projects: supermemoryProjects.map(({ name, description }) => ({
      name,
      description,
    })),
  }),
  {
    name: 'list_projects',
    description:
      "List the GitLab projects whose issue/discussion history is searchable via search_project_history and get_project_issue. Call this first if the user's question names or clearly implies one specific project, so you can scope to it — omitting `project` on search_project_history searches all of them, which is slower and can mix results from unrelated projects.",
    schema: z.object({}),
  },
);

const searchProjectHistorySchema = z.object({
  query: z
    .string()
    .describe(
      "Natural-language question about a project's GitLab issue and discussion history — e.g. who requested a feature and why, who worked on something, or its current status.",
    ),
  project: z
    .string()
    .optional()
    .describe(
      'Restrict the search to one project by name (see list_projects). Omit to search across all ingested projects.',
    ),
  limit: z.number().min(1).max(20).optional().default(5),
});

const searchProjectHistory = tool(
  async ({ query, project, limit }) => {
    const targets = project
      ? supermemoryProjects.filter((p) => p.name === project)
      : supermemoryProjects;
    if (project && !targets.length) {
      return {
        error: `Unknown project "${project}". Call list_projects to see available projects.`,
      };
    }

    const perProject = await Promise.all(
      targets.map(async (p) => {
        try {
          const res = await fetch(`${config.supermemory.url}/v4/search`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.supermemory.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              q: query,
              containerTag: p.containerTag,
              searchMode: 'memories',
              include: { relatedMemories: true },
              limit,
            }),
          });

          if (!res.ok) {
            return { project: p.name, error: `HTTP ${res.status}` };
          }

          const data = (await res.json()) as {
            results: SupermemorySearchResult[];
          };
          return {
            project: p.name,
            results: data.results.map((r) => ({
              fact: r.memory,
              similarity: r.similarity,
              project: p.name,
              issue: r.metadata?.iid,
              author: r.metadata?.author,
              state: r.metadata?.state,
              webUrl: r.metadata?.web_url,
            })),
          };
        } catch (err) {
          return {
            project: p.name,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const errors = perProject.filter((p) => 'error' in p);
    const results = perProject
      .flatMap((p) => p.results ?? [])
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return {
      results,
      ...(errors.length && {
        failedProjects: errors.map((e) => `${e.project}: ${e.error}`),
      }),
    };
  },
  {
    name: 'search_project_history',
    description:
      "Search extracted facts from ingested GitLab issue and discussion history (who reported/requested/fixed what, and when) — sourced from supermemory, not live GitLab. Each result is a short standalone fact, not the full discussion — it can be partial or lose context out of the surrounding thread. Before asserting anything consequential (a requirement's origin, who's responsible, current status), follow up with get_project_issue on the relevant issue's IID (and project) to verify against the full source rather than trusting one fact in isolation.",
    schema: searchProjectHistorySchema,
  },
);

const getProjectIssueSchema = z.object({
  project: z
    .string()
    .describe(
      'Project name, from a search_project_history result or list_projects.',
    ),
  iid: z
    .string()
    .describe(
      'GitLab issue IID to fetch full context for (the "issue" field from a search_project_history result).',
    ),
});

const getProjectIssue = tool(
  async ({ project, iid }) => {
    const target = supermemoryProjects.find((p) => p.name === project);
    if (!target) {
      return {
        error: `Unknown project "${project}". Call list_projects to see available projects.`,
      };
    }
    const projectId = target.containerTag.split(':')[1];
    try {
      const res = await fetch(
        `${config.supermemory.url}/v3/documents/issue-${projectId}-${iid}`,
        { headers: { Authorization: `Bearer ${config.supermemory.apiKey}` } },
      );

      if (res.status === 404) {
        return { error: `No ingested document for issue ${iid}` };
      }
      if (!res.ok) {
        return { error: `supermemory fetch failed: HTTP ${res.status}` };
      }

      const doc = (await res.json()) as { content: string };
      return { content: doc.content };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  {
    name: 'get_project_issue',
    description:
      "Fetch the full GitLab issue description and discussion thread for a specific issue, given its project and IID from a search_project_history result. Use this to verify a fact before relying on it — the full source may confirm it, add missing context, or show it doesn't actually answer the question (e.g. the origin/reasoning may genuinely not be recorded anywhere in the issue).",
    schema: getProjectIssueSchema,
  },
);

const queryPersonalMemoriesSchema = z.object({
  categories: z
    .array(z.enum(MEMORY_CATEGORIES as [string, ...string[]]))
    .optional(),
});

const queryPersonalMemories = tool(
  async ({ categories }, runtime: ToolRuntime<unknown, ChatToolContext>) => {
    const userId = runtime.context?.userId;
    if (!userId) {
      logger.warn(
        'query_personal_memories called without a userId on this run — dropping it',
      );
      return { error: 'no signed-in user for this run' };
    }
    return {
      memories: await memoriesDal.listByUser(
        userId,
        categories as MemoryCategory[] | undefined,
      ),
    };
  },
  {
    name: 'query_personal_memories',
    description:
      'Look up your own stored personal memories — durable facts, preferences, or decisions about the user, not tied to any project — optionally filtered by category. Call this before create_personal_memory to check whether something similar is already recorded.',
    schema: queryPersonalMemoriesSchema,
  },
);

const createPersonalMemorySchema = z.object({
  category: z
    .enum(MEMORY_CATEGORIES as [string, ...string[]])
    .describe(
      'knowledge = durable fact about the user or their work; preference = a stated preference to respect; lesson = a correction or misunderstanding worth avoiding next time; decision = a durable decision the user made',
    ),
  title: z.string().describe('Short title for this fact'),
  content: z
    .string()
    .describe(
      'The fact itself, with enough detail to be useful in a future, unrelated conversation',
    ),
  evidence: z
    .array(z.string())
    .default([])
    .describe('Direct quotes from this conversation backing this up'),
});

const createPersonalMemory = tool(
  async (
    { category, title, content, evidence },
    runtime: ToolRuntime<unknown, ChatToolContext>,
  ) => {
    const userId = runtime.context?.userId;
    if (!userId) {
      logger.warn(
        'create_personal_memory called without a userId on this run — dropping it',
      );
      return { error: 'no signed-in user for this run' };
    }
    const memory = await memoriesDal.insert({
      category: category as MemoryCategory,
      title,
      content,
      evidence,
      user_id: userId,
      project_id: null,
      source: {
        workflow: 'chat',
        threadId: runtime.context?.currentThreadId ?? '',
      },
    });
    return { created: true, id: memory.id };
  },
  {
    name: 'create_personal_memory',
    description:
      'Save a durable, personal fact worth remembering across future conversations. Call query_personal_memories first — if something similar already exists, call update_personal_memory instead of creating a duplicate.',
    schema: createPersonalMemorySchema,
  },
);

const updatePersonalMemorySchema = z.object({
  id: z
    .string()
    .describe(
      'id of the personal memory to update, from query_personal_memories',
    ),
  category: z.enum(MEMORY_CATEGORIES as [string, ...string[]]).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  evidence: z.array(z.string()).optional(),
});

const updatePersonalMemory = tool(
  async (
    { id, category, title, content, evidence },
    runtime: ToolRuntime<unknown, ChatToolContext>,
  ) => {
    const userId = runtime.context?.userId;
    if (!userId) {
      logger.warn(
        'update_personal_memory called without a userId on this run — dropping it',
      );
      return { error: 'no signed-in user for this run' };
    }
    const updated = await memoriesDal.updateByIdForUser(id, userId, {
      ...(category !== undefined && { category: category as MemoryCategory }),
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(evidence !== undefined && { evidence }),
    });
    if (!updated) return { error: 'Memory not found' };
    return { updated: true };
  },
  {
    name: 'update_personal_memory',
    description:
      'Update an existing personal memory in place — prefer this over create_personal_memory to avoid duplicates.',
    schema: updatePersonalMemorySchema,
  },
);

const deletePersonalMemorySchema = z.object({
  id: z
    .string()
    .describe(
      'id of the personal memory to delete, from query_personal_memories',
    ),
});

const deletePersonalMemory = tool(
  async ({ id }, runtime: ToolRuntime<unknown, ChatToolContext>) => {
    const userId = runtime.context?.userId;
    if (!userId) {
      logger.warn(
        'delete_personal_memory called without a userId on this run — dropping it',
      );
      return { error: 'no signed-in user for this run' };
    }
    const deleted = await memoriesDal.deleteByIdForUser(id, userId);
    if (!deleted) return { error: 'Memory not found' };
    return { deleted: true };
  },
  {
    name: 'delete_personal_memory',
    description:
      'Permanently remove a personal memory that is stale, wrong, or no longer relevant. Call query_personal_memories first to confirm the id.',
    schema: deletePersonalMemorySchema,
  },
);

const queryReviewThreadsSchema = z.object({
  projects: z.array(z.string()).optional(),
  statuses: z
    .array(z.enum(Object.values(RunStatus) as [string, ...string[]]))
    .optional(),
  pattern: z
    .string()
    .optional()
    .describe('Match against thread title. Omit to list without filtering.'),
  mode: searchModeSchema,
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

// Chat threads are excluded: the list DAL only returns them when a session id is supplied, which it isn't here.
const queryReviewThreads = tool(
  async ({ projects, statuses, pattern, mode, limit, offset }) => {
    const { data, total } = await threadsDal.list({
      projects,
      statuses,
      title: pattern
        ? { pattern, mode: mode as SearchMode | undefined }
        : undefined,
      limit,
      offset,
    });
    return {
      total,
      threads: data.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.latest_run_status,
        run_count: t.run_count,
        failure_count: t.failure_count,
        updated_at: t.updated_at,
      })),
    };
  },
  {
    name: 'query_review_threads',
    description:
      'Inspect MR-review threads: a filterable, paginated list of threads (id, title, status, run/failure counts), optionally matching a title pattern. Use query_review_thread_runs on a specific thread id to see its run history.',
    schema: queryReviewThreadsSchema,
  },
);

const searchChatThreadsSchema = z.object({
  pattern: z.string().describe('Match against past chat thread titles.'),
  mode: searchModeSchema,
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

const searchChatThreads = tool(
  async (
    { pattern, mode, limit, offset },
    runtime: ToolRuntime<unknown, ChatToolContext>,
  ) => {
    const userId = runtime.context?.userId;
    if (!userId) {
      logger.warn(
        'search_chat_threads called without a userId on this run — dropping it',
      );
      return { error: 'no signed-in user for this run' };
    }

    const { data, total } = await threadsDal.list({
      kinds: [RunKind.Chat],
      userId,
      title: { pattern, mode: mode as SearchMode | undefined },
      // Never surface the conversation the user is currently in as a "past" result.
      excludeId: runtime.context?.currentThreadId,
      limit,
      offset,
    });
    return {
      total,
      threads: data.map((t) => ({
        id: t.id,
        title: t.title,
        updated_at: t.updated_at,
      })),
    };
  },
  {
    name: 'search_chat_threads',
    description:
      "Search the current user's own past chat conversations by title pattern. Never returns another user's conversations.",
    schema: searchChatThreadsSchema,
  },
);

// Returns null for both "not found" and "found but it's a chat thread" — the caller shouldn't be able to tell the two apart.
async function findMrReviewThread(threadId: string) {
  const thread = await threadsDal.findById(threadId);
  if (!thread || thread.kind !== RunKind.MrReview) return null;
  return thread;
}

const queryReviewThreadRunsSchema = z.object({
  threadId: z.string(),
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

// Summaries only; use query_review_run for a specific run's full event transcript.
const queryReviewThreadRuns = tool(
  async ({ threadId, limit, offset }) => {
    if (!(await findMrReviewThread(threadId))) {
      return { error: 'Thread not found' };
    }

    const { runs, total } = await runsDal.getByThreadPage(
      threadId,
      limit,
      offset,
    );

    return {
      total,
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        error: r.error,
        model: r.input.model,
        created_at: r.created_at,
        started_at: r.started_at,
        updated_at: r.updated_at,
      })),
    };
  },
  {
    name: 'query_review_thread_runs',
    description:
      "List an MR-review thread's runs (status, model, timings, errors), paginated oldest-first.",
    schema: queryReviewThreadRunsSchema,
  },
);

const queryReviewRunSchema = z.object({
  runId: z.string(),
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

const queryReviewRun = tool(
  async ({ runId, limit, offset }) => {
    const run = await runsDal.findById(runId);
    if (!run || !(await findMrReviewThread(run.thread_id))) {
      return { error: 'Run not found' };
    }

    const total = run.events.length;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);

    return {
      id: run.id,
      status: run.status,
      error: run.error,
      model: run.input.model,
      created_at: run.created_at,
      started_at: run.started_at,
      updated_at: run.updated_at,
      totalEvents: total,
      events: run.events.slice(start, end),
    };
  },
  {
    name: 'query_review_run',
    description:
      "Inspect a specific MR-review run's full event transcript (messages, tool calls, tool outputs), paginated from the tail: offset 0 returns the most recent events (usually the run's conclusion), a larger offset walks back toward the start.",
    schema: queryReviewRunSchema,
  },
);

const searchReviewContentSchema = z.object({
  pattern: z
    .string()
    .describe(
      'Text to search for within MR-review run transcripts (messages, tool calls, tool outputs) — not just titles. Matches literal text only, not meaning — if a multi-word phrase finds nothing, retry with a single keyword or a regex OR-pattern (e.g. "hardware|PC") before giving up.',
    ),
  mode: z
    .enum(['substring', 'regex'])
    .optional()
    .describe(
      "'substring' (default, literal text) or 'regex' (case-insensitive POSIX regex). Fuzzy matching isn't supported for content search.",
    ),
  projects: z.array(z.string()).optional(),
  limit: z.number().min(1).max(50).optional().default(20),
  ...snippetControlSchema,
});

// Matches against the same JSON text runsDal.searchContent already filtered on (input and events combined) — good enough for a preview snippet, not meant to be byte-exact.
function extractSnippet(
  content: unknown,
  pattern: string,
  mode?: 'substring' | 'regex',
  radius = CONTENT_SNIPPET_RADIUS,
  full = false,
): string | null {
  const text = JSON.stringify(content);
  if (full) return text;

  let index: number;
  let length: number;

  if (mode === 'regex') {
    const match = new RegExp(pattern, 'i').exec(text);
    if (!match) return null;
    index = match.index;
    length = match[0].length;
  } else {
    index = text.toLowerCase().indexOf(pattern.toLowerCase());
    if (index === -1) return null;
    length = pattern.length;
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, end) +
    (end < text.length ? '…' : '')
  );
}

const searchReviewContent = tool(
  async ({ pattern, mode, projects, limit, radius, full }) => {
    const rows = await runsDal.searchContent({
      pattern,
      mode,
      projects,
      limit,
    });
    return {
      results: rows.map((r) => ({
        threadId: r.threadId,
        runId: r.runId,
        title: r.title,
        created_at: r.createdAt,
        snippet: extractSnippet(
          { input: r.input, events: r.events },
          pattern,
          mode,
          radius,
          full,
        ),
      })),
    };
  },
  {
    name: 'search_review_content',
    description:
      'Search within what was actually said in past MR reviews (assistant messages, tool calls, tool outputs), not just thread titles. Returns matching runs with a short snippet; use query_review_run for the full transcript.',
    schema: searchReviewContentSchema,
  },
);

const searchChatContentSchema = z.object({
  pattern: z
    .string()
    .describe(
      'Text to search for within your own past chat messages — not just titles. Matches literal text only, not meaning — if a multi-word phrase finds nothing, retry with a single keyword or a regex OR-pattern (e.g. "hardware|PC") before giving up.',
    ),
  mode: z
    .enum(['substring', 'regex'])
    .optional()
    .describe(
      "'substring' (default, literal text) or 'regex' (case-insensitive POSIX regex). Fuzzy matching isn't supported for content search.",
    ),
  limit: z.number().min(1).max(50).optional().default(20),
  ...snippetControlSchema,
});

const searchChatContent = tool(
  async (
    { pattern, mode, limit, radius, full },
    runtime: ToolRuntime<unknown, ChatToolContext>,
  ) => {
    const userId = runtime.context?.userId;
    if (!userId) {
      logger.warn(
        'search_chat_content called without a userId on this run — dropping it',
      );
      return { error: 'no signed-in user for this run' };
    }

    const rows = await runsDal.searchChatContent({
      pattern,
      mode,
      userId,
      excludeId: runtime.context?.currentThreadId,
      limit,
    });
    return {
      results: rows.map((r) => ({
        threadId: r.threadId,
        runId: r.runId,
        title: r.title,
        created_at: r.createdAt,
        snippet: extractSnippet(
          { input: r.input, events: r.events },
          pattern,
          mode,
          radius,
          full,
        ),
      })),
    };
  },
  {
    name: 'search_chat_content',
    description:
      "Search within what was actually said in your own past chat conversations, not just titles. Returns matching runs with a short snippet. Never returns another user's conversations.",
    schema: searchChatContentSchema,
  },
);

// Same package MR-review spawns over stdio, but as a second long-lived streamable-http + remote-auth instance so each chat run can forward its own user's GitLab token.
const gitlabMcpBin = createRequire(import.meta.url).resolve(
  '@zereight/mcp-gitlab/build/index.js',
);

// Bound to loopback so the token-forwarding endpoint is never externally reachable.
const gitlabMcpPort = 3101;
const gitlabMcpUrl = `http://127.0.0.1:${gitlabMcpPort}/mcp`;

let proc: ChildProcess | null = null;

// Resolve once the server is accepting connections so the first chat run can't race a not-yet-listening process.
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`chat GitLab MCP server never opened port ${port}`));
        } else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

export const chatMcpServer = {
  start: async () => {
    if (proc) return;

    proc = spawn('node', [gitlabMcpBin], {
      env: {
        ...process.env,
        STREAMABLE_HTTP: 'true',
        // Token comes from each request's Authorization header, not the env.
        REMOTE_AUTHORIZATION: 'true',
        HOST: '127.0.0.1',
        PORT: String(gitlabMcpPort),
        GITLAB_API_URL: config.gitlab.apiUrl,
        GITLAB_TOOLSETS: 'all',
        LOG_LEVEL: process.env.NODE_ENV === 'development' ? '' : 'silent',
        GITLAB_DISABLE_VERSION_CHECK:
          process.env.NODE_ENV === 'development' ? '' : 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (d) =>
      logger.debug({ mcp: 'chat-gitlab' }, String(d).trim()),
    );
    proc.stderr?.on('data', (d) =>
      logger.warn({ mcp: 'chat-gitlab' }, String(d).trim()),
    );
    proc.on('exit', (code, signal) => {
      logger.warn({ code, signal }, '[chat-mcp] GitLab MCP server exited');
      proc = null;
    });

    await waitForPort(gitlabMcpPort, 15_000);
    logger.info({ port: gitlabMcpPort }, '[chat-mcp] GitLab MCP server ready');
  },

  stop: () => {
    proc?.kill();
    proc = null;
  },
};

// client.close() only tears down the local connection; without this the GitLab MCP server holds the session's dedicated Server instance in memory until its own idle timeout fires.
async function terminateGitlabSession(
  client: MultiServerMCPClient | null,
): Promise<void> {
  const transport = (await client?.getClient('gitlab'))?.transport;
  if (transport && 'terminateSession' in transport) {
    await (transport as { terminateSession: () => Promise<void> })
      .terminateSession()
      .catch((err: unknown) => {
        logger.warn({ err }, 'failed to terminate GitLab MCP session');
      });
  }
}

type BuildChatToolsOptions = {
  server: boolean;
  gitlab: boolean;
  webSearch: boolean;
  gitlabToken?: string;
};

// Built fresh per run, not a module singleton like MR-review's stdio client — GitLab's token rides as a per-request header, and the browser context isolates one run's cookies/navigation from another's, so both must be constructed and torn down within the run's own lifetime.
export async function buildChatTools({
  server,
  gitlab,
  webSearch,
  gitlabToken,
}: BuildChatToolsOptions): Promise<{
  tools: DynamicStructuredTool[];
  close: () => Promise<void>;
}> {
  // Recall about this user's own conversations — memory and search alike — isn't an optional diagnostics tool, always available, like write_todos.
  const tools: DynamicStructuredTool[] = [
    queryPersonalMemories,
    createPersonalMemory,
    updatePersonalMemory,
    deletePersonalMemory,
    searchChatThreads,
    searchChatContent,
  ];
  let client: MultiServerMCPClient | null = null;
  let browser: Browser | null = null;
  let browserContext: BrowserContext | null = null;

  // Not configured everywhere (PoC) — skip rather than register tools that can only ever error.
  if (config.supermemory.apiKey && supermemoryProjects.length) {
    tools.push(listProjects, searchProjectHistory, getProjectIssue);
  }

  if (server) {
    tools.push(
      queryProjectMemories,
      queryReviewThreads,
      queryReviewThreadRuns,
      queryReviewRun,
      searchReviewContent,
    );
  }

  // No token → no GitLab client at all, so we never open an unusable connection.
  if (gitlab && gitlabToken) {
    client = new MultiServerMCPClient({
      prefixToolNameWithServerName: true,
      useStandardContentBlocks: true,
      mcpServers: {
        gitlab: {
          transport: 'http',
          url: gitlabMcpUrl,
          // secret: token rides only in this transport header, never as a tool arg
          headers: { Authorization: `Bearer ${gitlabToken}` },
          automaticSSEFallback: false,
        },
      },
    });

    tools.push(...(await client.getTools()));
  }

  if (webSearch) {
    browser = await puppeteer.connect({
      browserURL: config.lightpanda.cdpUrl,
    });
    // An isolated context so concurrent chat runs don't share cookies/navigation state on Lightpanda's one shared browser.
    browserContext = await browser.createBrowserContext();
    tools.push(buildFetchWebPageTool(browserContext));
  }

  return {
    tools,
    close: async () => {
      // Must terminate before close(): close() aborts the transport's request signal, which would cancel the DELETE terminateSession() sends.
      await terminateGitlabSession(client);
      await client?.close();
      // disconnect(), not close() — this is Lightpanda's shared browser process, not ours to shut down.
      await browserContext?.close();
      browser?.disconnect();
    },
  };
}
