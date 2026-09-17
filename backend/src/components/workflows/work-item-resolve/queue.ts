import type { Job } from 'bullmq';

import type { WorkItemResolveRunInput } from '#types.js';
import { RunKind } from '#types.js';

import { createRunQueue } from '#components/runs/bullmq.js';
import { runsService } from '#components/runs/service.js';
import { threadsDal } from '#components/threads/dal.js';

import { config } from '#utils/config.js';
import { logger } from '#utils/logger.js';

type WorkItemResolveJob = {
  threadId: string;
  runId: string;
  checkpointId?: string;
} & WorkItemResolveRunInput;

const QUEUE_NAME = 'work-item-resolve';
const JOB_NAME = 'work-item-resolve';

async function processWorkItemResolve(
  data: WorkItemResolveJob,
  queueWaitMs: number,
) {
  const { threadId, runId, checkpointId, ...input } = data;
  await runsService.start(
    threadId,
    runId,
    RunKind.WorkItemResolve,
    input,
    undefined,
    checkpointId,
    queueWaitMs,
  );
}

const {
  queue: workItemResolveQueue,
  worker: workItemResolveWorker,
  getStatus,
} = createRunQueue<WorkItemResolveJob>({
  queueName: QUEUE_NAME,
  concurrency: config.workItemResolve.concurrency,
  lockDuration: config.workItemResolve.lockDuration,
  maxStalledCount: config.workItemResolve.maxStalledCount,
  process: processWorkItemResolve,
});

export { getStatus, workItemResolveQueue, workItemResolveWorker };

// Coalesced, not collapsed — runs always re-fetch live state, so this only means "run once more," never "replay a specific trigger."
async function drainPendingRerun(job: Job<WorkItemResolveJob>) {
  const {
    threadId,
    kind,
    projectPath,
    issueIid,
    defaultBranch,
    assignedBy,
    model,
    config: runConfig,
    issueKind,
  } = job.data;

  const shouldRerun = await threadsDal.consumePendingRerun(threadId);
  if (!shouldRerun) return;

  const input: WorkItemResolveRunInput = {
    kind,
    projectPath,
    issueIid,
    defaultBranch,
    assignedBy,
    model,
    config: runConfig,
    issueKind,
  };
  const run = await runsService.create(
    threadId,
    RunKind.WorkItemResolve,
    input,
  );
  await enqueueWorkItemResolve({ threadId, runId: run.id, ...input });
}

function onTerminal(job: Job<WorkItemResolveJob> | undefined) {
  if (!job) return;
  drainPendingRerun(job).catch((err) =>
    logger.error(
      { err, job: job.data },
      '[work-item-resolve-worker] failed to drain pending rerun',
    ),
  );
}

workItemResolveWorker?.on('completed', onTerminal);
workItemResolveWorker?.on('failed', (job, err) => {
  logger.error(
    { err, job: job?.data },
    `[work-item-resolve-worker] job ${job?.id} failed`,
  );
  onTerminal(job);
});

export type EnqueueWorkItemResolveResult = 'fresh' | 'coalesced';

export async function enqueueWorkItemResolve(data: WorkItemResolveJob) {
  if (config.mock.queue) {
    logger.debug(
      { threadId: data.threadId },
      '[mock-queue] running work-item-resolve directly',
    );
    processWorkItemResolve(data, 0).catch((err) =>
      logger.error(
        { err, threadId: data.threadId },
        '[mock-queue] work-item-resolve failed',
      ),
    );
    return 'fresh';
  }

  // Fresh jobId + dedup id is the atomic signal (ours comes back iff free) — a bare duplicate jobId isn't, BullMQ no-ops that silently.
  const job = await workItemResolveQueue!.add(JOB_NAME, data, {
    jobId: data.runId,
    deduplication: { id: data.threadId },
  });

  if (job.id === data.runId) return 'fresh';

  await Promise.all([
    runsService.supersedeById(data.runId, data.threadId),
    threadsDal.setPendingRerun(data.threadId),
  ]);

  return 'coalesced';
}
