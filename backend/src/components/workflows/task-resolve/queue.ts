import type { Job } from 'bullmq';

import type { TaskResolveRunInput } from '#types.js';
import { RunKind } from '#types.js';

import { createRunQueue } from '#components/runs/bullmq.js';
import { runsService } from '#components/runs/service.js';
import { threadsDal } from '#components/threads/dal.js';

import { config } from '#utils/config.js';
import { logger } from '#utils/logger.js';

type TaskResolveJob = {
  threadId: string;
  runId: string;
  checkpointId?: string;
} & TaskResolveRunInput;

const QUEUE_NAME = 'task-resolve';
const JOB_NAME = 'task-resolve';

async function processTaskResolve(data: TaskResolveJob, queueWaitMs: number) {
  const { threadId, runId, checkpointId, ...input } = data;
  await runsService.start(
    threadId,
    runId,
    RunKind.TaskResolve,
    input,
    undefined,
    checkpointId,
    queueWaitMs,
  );
}

const {
  queue: taskResolveQueue,
  worker: taskResolveWorker,
  getStatus,
} = createRunQueue<TaskResolveJob>({
  queueName: QUEUE_NAME,
  concurrency: config.taskResolve.concurrency,
  lockDuration: config.taskResolve.lockDuration,
  maxStalledCount: config.taskResolve.maxStalledCount,
  process: processTaskResolve,
});

export { getStatus, taskResolveQueue, taskResolveWorker };

// Coalesced, not collapsed — runs always re-fetch live state, so this only means "run once more," never "replay a specific trigger."
async function drainPendingRerun(job: Job<TaskResolveJob>) {
  const {
    threadId,
    kind,
    title,
    projectPath,
    prompt,
    defaultBranch,
    submittedBy,
    model,
    config: runConfig,
  } = job.data;

  const shouldRerun = await threadsDal.consumePendingRerun(threadId);
  if (!shouldRerun) return;

  const input: TaskResolveRunInput = {
    kind,
    title,
    projectPath,
    prompt,
    defaultBranch,
    submittedBy,
    model,
    config: runConfig,
  };
  const run = await runsService.create(threadId, RunKind.TaskResolve, input);
  await enqueueTaskResolve({ threadId, runId: run.id, ...input });
}

function onTerminal(job: Job<TaskResolveJob> | undefined) {
  if (!job) return;
  drainPendingRerun(job).catch((err) =>
    logger.error(
      { err, job: job.data },
      '[task-resolve-worker] failed to drain pending rerun',
    ),
  );
}

taskResolveWorker?.on('completed', onTerminal);
taskResolveWorker?.on('failed', (job, err) => {
  logger.error(
    { err, job: job?.data },
    `[task-resolve-worker] job ${job?.id} failed`,
  );
  onTerminal(job);
});

export async function enqueueTaskResolve(data: TaskResolveJob) {
  if (config.mock.queue) {
    logger.debug(
      { threadId: data.threadId },
      '[mock-queue] running task-resolve directly',
    );
    processTaskResolve(data, 0).catch((err) =>
      logger.error(
        { err, threadId: data.threadId },
        '[mock-queue] task-resolve failed',
      ),
    );
    return 'fresh';
  }

  // Fresh jobId + dedup id is the atomic signal (ours comes back iff free) — a bare duplicate jobId isn't, BullMQ no-ops that silently.
  const job = await taskResolveQueue!.add(JOB_NAME, data, {
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
