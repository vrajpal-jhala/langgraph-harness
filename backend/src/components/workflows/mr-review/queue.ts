import type { MrReviewRunInput, RunJob } from '#types.js';
import { RunKind, RunStatus } from '#types.js';

import { createRunQueue } from '#components/runs/bullmq.js';
import { runsService } from '#components/runs/service.js';
import { workflowsService } from '#components/workflows/service.js';

import { config } from '#utils/config.js';
import { logger } from '#utils/logger.js';

type EnqueueMrReviewResult =
  { status: 'fresh' } | { status: 'replaced' } | { status: 'active' };

const QUEUE_NAME = 'reviews';
const JOB_NAME = 'review';

async function processMrReview(data: RunJob, queueWaitMs: number) {
  const {
    threadId,
    runId,
    kind,
    query,
    model,
    reasoning,
    config: runConfig,
    checkpointId,
  } = data;

  await runsService.start(
    threadId,
    runId,
    kind,
    { kind, query, model, reasoning, config: runConfig },
    undefined,
    checkpointId,
    queueWaitMs,
  );
}

const {
  queue: mrReviewQueue,
  worker: mrReviewWorker,
  getStatus,
} = createRunQueue<RunJob>({
  queueName: QUEUE_NAME,
  concurrency: config.mrReview.concurrency,
  lockDuration: config.mrReview.lockDuration,
  maxStalledCount: config.mrReview.maxStalledCount,
  process: processMrReview,
});

export { getStatus, mrReviewQueue, mrReviewWorker };

export function initQueueHandlers() {
  if (!mrReviewWorker || !mrReviewQueue) return;

  mrReviewWorker.on('completed', (job) => {
    void (async () => {
      try {
        const { threadId } = job.data;
        const runs = await runsService.list(threadId);
        const pending = runs
          .filter((r) => r.status === RunStatus.QUEUED)
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

        if (pending.length === 0) return;

        // Debounce: collapse stacked pushes into the latest.
        for (const r of pending.slice(1)) {
          logger.info(
            { runId: r.id, threadId, status: r.status },
            '[mr-review-worker] superseding stacked pending run',
          );
          await runsService.supersedeById(r.id, threadId);
        }

        const toRun = pending[0];
        if (workflowsService.forKind(toRun.kind).startMode !== 'queued') return;
        const { query, model, reasoning, config } =
          toRun.input as MrReviewRunInput;
        await enqueueMrReview(
          `review:${query.projectId}:${query.mrIid}`,
          {
            threadId,
            runId: toRun.id,
            kind: RunKind.MrReview,
            query,
            model,
            reasoning,
            config,
          },
          0,
        );
      } catch (e) {
        logger.error(
          { err: e, job: job?.data },
          '[mr-review-worker] completed handler error',
        );
      }
    })();
  });

  mrReviewWorker.on('failed', (job, err) => {
    logger.error(
      { err, job: job?.data },
      `[mr-review-worker] job ${job?.id} failed`,
    );

    if (job?.data?.threadId) {
      const { threadId } = job.data;
      runsService
        .failPending(threadId)
        .catch((e) =>
          logger.error(
            { err: e, threadId },
            '[mr-review-worker] failed to update run status after job failure',
          ),
        );
    }
  });

  mrReviewWorker.on('stalled', (jobId) => {
    // BullMQ's EventEmitter discards async handler return values, so wrap in a void IIFE with try/catch to avoid unhandled rejections.
    void (async () => {
      try {
        logger.warn({ jobId }, '[mr-review-worker] job stalled');
        const job = await mrReviewQueue!.getJob(jobId);
        // If BullMQ already GC'd the job (maxStalledCount exhausted), job is null and the 'failed' handler is the safety net that unsticks the run.
        if (job?.data?.threadId) {
          await runsService.failPending(job.data.threadId);
        }
      } catch (e) {
        logger.error(
          { err: e, jobId },
          '[mr-review-worker] stalled handler error',
        );
      }
    })();
  });
}

export async function enqueueMrReview(
  jobId: string,
  data: RunJob,
  delay = config.mrReview.debounce,
): Promise<EnqueueMrReviewResult> {
  if (config.mock.queue) {
    logger.debug({ jobId }, '[mock-queue] running mr-review directly');
    processMrReview(data, 0).catch((err) =>
      logger.error(
        { err, threadId: data.threadId },
        '[mock-queue] failed to create run',
      ),
    );
    return { status: 'fresh' };
  }

  const existing = await mrReviewQueue!.getJob(jobId);

  if (!existing) {
    await mrReviewQueue!.add(JOB_NAME, data, { jobId, delay: 0 });
    return { status: 'fresh' };
  }

  const { runId: previousRunId, threadId: previousThreadId } = existing.data;
  // jobId is stable per-MR and reused across pushes, so "existing" may already be completed/failed, not a genuine pending duplicate.
  const previousState = await existing.getState();
  const wasPending = previousState === 'waiting' || previousState === 'delayed';

  try {
    await existing.remove();
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('locked')) {
      // Job is actively running — caller must fail the run record it just created.
      logger.debug(
        { jobId },
        '[mr-review-queue] job locked, skipping re-enqueue',
      );
      return { status: 'active' };
    }
    throw err;
  }

  if (wasPending) {
    logger.info(
      { runId: previousRunId, threadId: previousThreadId },
      '[mr-review-queue] superseding pending run replaced by a newer push',
    );
    runsService
      .supersedeById(previousRunId, previousThreadId)
      .catch((err) =>
        logger.error(
          { err, runId: previousRunId },
          '[mr-review-queue] failed to supersede replaced run',
        ),
      );
  } else {
    logger.debug(
      { jobId, previousRunId, previousState },
      '[mr-review-queue] cleared stale completed/failed job, preserving its run record',
    );
  }
  // If nothing was pending, run immediately instead of debouncing against a job that no longer exists.
  await mrReviewQueue!.add(JOB_NAME, data, {
    jobId,
    delay: wasPending ? delay : 0,
  });
  return { status: 'replaced' };
}
