import { analyticsService } from '#components/analytics/service.js';
import { repositoriesManager } from '#components/repositories/manager.js';
import { runsService } from '#components/runs/service.js';
import { initQueueHandlers } from '#components/workflows/mr-review/queue.js';
import { workflows, workflowsService } from '#components/workflows/service.js';
import { config } from './config.js';
import { pool } from './db.js';
import { validateEnv } from './env.js';
import { logger } from './logger.js';

export const services = {
  init: async () => {
    validateEnv();
    // Eagerly connect so pg's lazy require('net'/'tls') happens now, while the tsx watch IPC channel is still open, not mid-request during a restart.
    const client = await pool.connect();
    client.release();
    for (const workflow of workflows) await workflow.init();

    // Reconcile `git worktree list` against worktree_leases before any review can acquire one.
    await repositoriesManager.reconcile();
    repositoriesManager.startMaintenanceLoop();

    if (config.mock.workflow) {
      logger.info(
        '[tools/nodes] mock mode — LLM emulates tool calls, write/expensive tools/nodes are disabled',
      );
    }

    // Fail stale rows left RUNNING (interruptedRuns) or QUEUED (orphanedRuns) by a prior crash so they don't get stuck forever.
    const { interruptedRuns, orphanedRuns } =
      await runsService.failAllPending();

    await analyticsService.recordOrphanedRuns([
      ...interruptedRuns,
      ...orphanedRuns,
    ]);

    if (config.mock.queue) {
      logger.info('[queue] mock mode — reviews run directly, BullMQ disabled');
      return;
    }

    initQueueHandlers();
    const byThread = new Map<string, (typeof interruptedRuns)[0]>();
    for (const run of [...interruptedRuns, ...orphanedRuns]) {
      // Only workflows defining recoverOrphanedRun participate — a dead chat run just stays failed, never re-run.
      if (!workflowsService.forKind(run.kind).recoverOrphanedRun) continue;
      // Dedupe by thread: mr-review threads are 1:1 with an MR, so keep only the more recent of an orphaned/interrupted pair to avoid two concurrent reviews.
      const existing = byThread.get(run.thread_id);
      if (!existing || run.created_at > existing.created_at) {
        byThread.set(run.thread_id, run);
      }
    }
    for (const run of byThread.values()) {
      await workflowsService.forKind(run.kind).recoverOrphanedRun!(run).catch(
        (err) =>
          logger.error(
            { err, runId: run.id, threadId: run.thread_id },
            '[orphan-recovery] failed',
          ),
      );
    }
  },
};
