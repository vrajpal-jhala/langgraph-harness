import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MCPAdapter } from '@langchain/mcp-adapters';

import { config } from '#utils/config.js';
import { throwOnToolError } from '#utils/helpers.js';

let adapter: MCPAdapter | null = null;
let toolsPromise: Promise<DynamicStructuredTool[]> | null = null;

// GitHub's server ships as a Go binary, not an npm package — so it's reached over HTTP (hosted by default, or a self-run container via GITHUB_MCP_URL) instead of stdio like GitLab's.
async function connect(): Promise<DynamicStructuredTool[]> {
  adapter = new MCPAdapter({
    servers: {
      github: {
        transport: 'http',
        url: config.github.mcpUrl,
        headers: {
          Authorization: `Bearer ${config.github.pat}`,
          'X-MCP-Toolsets': 'issues,pull_requests',
        },
      },
    },
  });

  return throwOnToolError(await adapter.listTools());
}

export const githubMcp = {
  // Memoized so concurrent callers await the same connection instead of racing two sessions.
  getTools: (): Promise<DynamicStructuredTool[]> => {
    toolsPromise ??= connect();
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
