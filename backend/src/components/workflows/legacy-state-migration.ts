import type { RunnableConfig } from '@langchain/core/runnables';

import { checkpointer } from '#utils/db.js';
import { logger } from '#utils/logger.js';

type Graph = {
  getState: (config: RunnableConfig) => Promise<{ next: string[] }>;
  updateState: (
    config: RunnableConfig,
    values: Record<string, unknown>,
    asNode: string,
  ) => Promise<RunnableConfig>;
};

// LangGraph drops a renamed state channel's saved value, so a thread last run before the rename would lose it. Copies each old channel's value into its new name the first time the thread runs again, and returns the checkpoint to resume from.
// TODO - delete a few releases after this ships, once upgrading from a release that predates the renames is no longer supported.
export async function migrateLegacyState(params: {
  graph: Graph;
  threadId: string;
  checkpointId?: string;
  renames: Record<string, string>;
  // The graph's nodes in run order — updateState drops pending tasks unless told which node just ran, and in a linear graph that's the one before the pending node.
  nodeOrder: string[];
}) {
  const { graph, threadId, checkpointId, renames, nodeOrder } = params;
  const config = {
    configurable: {
      thread_id: threadId,
      ...(checkpointId && { checkpoint_id: checkpointId }),
    },
  };
  try {
    const stored = (await checkpointer.getTuple(config))?.checkpoint
      .channel_values as Record<string, unknown> | undefined;
    if (!stored) return checkpointId;

    const migrated: Record<string, unknown> = {};
    for (const [from, to] of Object.entries(renames)) {
      if (stored[from] !== undefined && stored[to] === undefined) {
        migrated[to] = stored[from];
      }
    }
    if (!Object.keys(migrated).length) return checkpointId;

    const { next } = await graph.getState(config);
    const pendingIndex = next.length === 1 ? nodeOrder.indexOf(next[0]) : -1;
    const asNode = next.length
      ? nodeOrder[pendingIndex - 1]
      : nodeOrder[nodeOrder.length - 1];
    if (!asNode) {
      logger.warn(
        { threadId, next },
        '[legacy-state-migration] no node to resume after, skipped',
      );
      return checkpointId;
    }

    const updated = await graph.updateState(config, migrated, asNode);
    logger.info(
      { threadId, channels: Object.keys(migrated) },
      '[legacy-state-migration] migrated renamed state channels',
    );
    // A retry from a chosen checkpoint resumes from the fork updateState wrote, not the original.
    return checkpointId
      ? (updated.configurable?.checkpoint_id as string)
      : checkpointId;
  } catch (err) {
    logger.warn(
      { err, threadId },
      '[legacy-state-migration] migration failed, skipped',
    );
    return checkpointId;
  }
}
