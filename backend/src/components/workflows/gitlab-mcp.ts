import { createRequire } from 'node:module';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MCPAdapter } from '@langchain/mcp-adapters';

import { config } from '#utils/config.js';
import { throwOnToolError } from '#utils/helpers.js';

// resolve the locally installed binary instead of npx
const gitlabMcpBin = createRequire(import.meta.url).resolve(
  '@zereight/mcp-gitlab/build/index.js',
);

let adapter: MCPAdapter | null = null;
let toolsPromise: Promise<DynamicStructuredTool[]> | null = null;

async function connect(): Promise<DynamicStructuredTool[]> {
  adapter = new MCPAdapter({
    servers: {
      gitlab: {
        transport: 'stdio',
        mode: 'legacy',
        command: 'node',
        args: [gitlabMcpBin],
        env: {
          GITLAB_PERSONAL_ACCESS_TOKEN: config.gitlab.pat,
          GITLAB_TOOLSETS: 'all',
          LOG_LEVEL: process.env.NODE_ENV === 'development' ? '' : 'silent',
          GITLAB_DISABLE_VERSION_CHECK:
            process.env.NODE_ENV === 'development' ? '' : 'true',
        },
      },
    },
  });

  return throwOnToolError(await adapter.listTools());
}

export const gitlabMcp = {
  // Memoized so concurrent callers await the same connection instead of racing two subprocesses.
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
    await toClose.close();
  },
};
