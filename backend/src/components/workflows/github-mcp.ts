import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MCPAdapter } from '@langchain/mcp-adapters';

import { config } from '#utils/config.js';
import {
  assertMcpToolNames,
  listMcpTools,
  mcpToolNameOptions,
  throwOnToolError,
} from '#utils/helpers.js';

export function createGithubMcpAdapter(
  token: string,
  toolsets: string,
): MCPAdapter {
  return new MCPAdapter({
    ...mcpToolNameOptions('github'),
    servers: {
      github: {
        transport: 'http',
        url: config.github.mcpUrl,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-MCP-Toolsets': toolsets,
        },
      },
    },
  });
}

let adapter: MCPAdapter | null = null;
let toolsPromise: Promise<DynamicStructuredTool[]> | null = null;

async function connect(): Promise<DynamicStructuredTool[]> {
  adapter = createGithubMcpAdapter(config.github.pat, 'issues,pull_requests');

  const listed = await listMcpTools(
    adapter,
    'GitHub',
    config.github.mcpUrl,
    'GITHUB_MCP_URL',
  );
  return throwOnToolError(assertMcpToolNames(listed, 'github'));
}

export const githubMcp = {
  // Memoized so concurrent callers await the same connection instead of racing two sessions.
  getTools: (): Promise<DynamicStructuredTool[]> => {
    // A failed connect isn't kept, so a call made before the container was listening doesn't break GitHub tools until restart.
    toolsPromise ??= connect().catch((err) => {
      toolsPromise = null;
      const failed = adapter;
      adapter = null;
      void failed?.close().catch(() => {});
      throw err;
    });
    return toolsPromise;
  },
  close: async (): Promise<void> => {
    if (!adapter) return;
    const toClose = adapter;
    adapter = null;
    toolsPromise = null;
    await toClose.close();
  },
};
