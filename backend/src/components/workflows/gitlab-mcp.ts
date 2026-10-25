import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MCPAdapter } from '@langchain/mcp-adapters';

import { config } from '#utils/config.js';
import {
  assertMcpToolNames,
  mcpToolNameOptions,
  throwOnToolError,
} from '#utils/helpers.js';
import { logger } from '#utils/logger.js';

type ToolFunc = DynamicStructuredTool['func'];

type OpenedConnection = {
  next: MCPAdapter;
  tools: DynamicStructuredTool[];
};

export function createGitlabMcpAdapter(token: string): MCPAdapter {
  return new MCPAdapter({
    ...mcpToolNameOptions('gitlab'),
    servers: {
      gitlab: {
        transport: 'http',
        mode: 'legacy',
        // @zereight/mcp-gitlab is an SDK 1 server; a fallback would resend the Bearer token to a guessed /sse URL
        automaticSSEFallback: false,
        url: config.gitlab.mcpUrl,
        // secret: token rides only in this transport header, never as a tool arg
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  });
}

// adapter.close() only tears down the local connection; without this the GitLab MCP server holds the session's dedicated Server instance in memory until its own idle timeout fires.
export async function terminateGitlabSession(
  adapter: MCPAdapter | null,
): Promise<void> {
  try {
    // getClient() re-runs discovery, which throws on a session the server already dropped
    const transport = (await adapter?.getClient('gitlab'))?.transport;
    if (transport && 'terminateSession' in transport) {
      await (
        transport as { terminateSession: () => Promise<void> }
      ).terminateSession();
    }
  } catch (err) {
    logger.warn({ err }, 'failed to terminate GitLab MCP session');
  }
}

// The server answers 404 to a request carrying an expired or unknown mcp-session-id (idle timeout, or the container restarted); the adapter wraps the SDK's error, so the status sits on a cause.
function isSessionLost(err: unknown): boolean {
  let current = err;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    const { data, cause } = current as {
      data?: { status?: unknown };
      cause?: unknown;
    };
    if (data?.status === 404) return true;
    current = cause;
  }
  return false;
}

let adapter: MCPAdapter | null = null;
let liveFuncs = new Map<string, ToolFunc>();
let toolsPromise: Promise<DynamicStructuredTool[]> | null = null;
let reconnecting: Promise<void> | null = null;

async function open(): Promise<OpenedConnection> {
  const next = createGitlabMcpAdapter(config.gitlab.pat);

  try {
    return {
      next,
      tools: assertMcpToolNames(await next.listTools(), 'gitlab'),
    };
  } catch (err) {
    // not terminateGitlabSession: its getClient() re-runs discovery, retrying the connection that just failed
    await next.close();
    throw err;
  }
}

async function release(toClose: MCPAdapter): Promise<void> {
  await terminateGitlabSession(toClose);
  await toClose.close();
}

// Returns the connection it replaced, if any.
function adopt({ next, tools }: OpenedConnection): MCPAdapter | null {
  const previous = adapter;
  adapter = next;
  liveFuncs = new Map(tools.map((tool) => [tool.name, tool.func]));
  return previous;
}

// `stale` is the connection the caller failed on, so a caller arriving after another already reconnected doesn't open a second session.
function reconnect(stale: MCPAdapter | null): Promise<void> {
  // A null `stale` means close() already ran; reconnecting then would orphan a session.
  if (!stale || adapter !== stale) return Promise.resolve();

  reconnecting ??= open()
    .then(async (opened) => {
      // close() ran while this was connecting, so nothing else would ever release the new session
      if (!adapter) return release(opened.next);

      await adopt(opened)
        ?.close()
        .catch((err: unknown) => {
          logger.warn({ err }, 'failed to close stale GitLab MCP connection');
        });
    })
    .finally(() => {
      reconnecting = null;
    });

  return reconnecting;
}

function callLive(name: string, args: Parameters<ToolFunc>) {
  const func = liveFuncs.get(name);
  if (!func) throw new Error(`GitLab MCP tool ${name} is no longer available`);
  return func(...args);
}

// Workflows hold these tool objects for the process lifetime, so recovery re-points what they call instead of replacing them.
function withReconnect(tool: DynamicStructuredTool): void {
  tool.func = async (...args) => {
    const used = adapter;

    try {
      return await callLive(tool.name, args);
    } catch (err) {
      if (!isSessionLost(err)) throw err;

      logger.warn({ tool: tool.name }, 'GitLab MCP session lost, reconnecting');
      await reconnect(used);
      return callLive(tool.name, args);
    }
  };
}

async function connect(): Promise<DynamicStructuredTool[]> {
  const opened = await open();
  // adopt first: liveFuncs must capture the raw funcs, not the wrappers, which would call themselves
  adopt(opened);
  opened.tools.forEach(withReconnect);

  return throwOnToolError(opened.tools);
}

export const gitlabMcp = {
  // Memoized so concurrent callers await the same connection instead of racing two sessions.
  getTools: (): Promise<DynamicStructuredTool[]> => {
    toolsPromise ??= connect();
    return toolsPromise;
  },
  // Idempotent — so more than one workflow can call this concurrently at shutdown.
  close: async (): Promise<void> => {
    if (!adapter) return;
    const toClose = adapter;
    adapter = null;
    toolsPromise = null;
    await release(toClose);
  },
};
