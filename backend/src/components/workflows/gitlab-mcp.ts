import { createRequire } from 'node:module';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

import { config } from '#utils/config.js';

// resolve the locally installed binary instead of npx
const gitlabMcpBin = createRequire(import.meta.url).resolve(
  '@zereight/mcp-gitlab/build/index.js',
);

let client: MultiServerMCPClient | null = null;
let toolsPromise: Promise<DynamicStructuredTool[]> | null = null;

async function connect(): Promise<DynamicStructuredTool[]> {
  client = new MultiServerMCPClient({
    prefixToolNameWithServerName: true,
    useStandardContentBlocks: true,
    mcpServers: {
      gitlab: {
        transport: 'stdio',
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

  return client.getTools();
}

export const gitlabMcp = {
  // Memoized so concurrent callers await the same connection instead of racing two subprocesses.
  getTools: (): Promise<DynamicStructuredTool[]> => {
    toolsPromise ??= connect();
    return toolsPromise;
  },
  // Idempotent — so more than one workflow can call this concurrently at shutdown.
  close: async (): Promise<void> => {
    if (!client) return;
    const toClose = client;
    client = null;
    toolsPromise = null;
    await toClose.close();
  },
};
