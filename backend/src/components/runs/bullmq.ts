import type { Processor, WorkerOptions } from 'bullmq';
import { Queue, Worker } from 'bullmq';

import { config } from '#utils/config.js';
import { logger } from '#utils/logger.js';

type QueueStatus = {
  active: number;
  waiting: number;
  delayed: number;
  jobs: {
    runId?: string;
    threadId: string;
    state: string;
    delayRemaining?: number;
  }[];
};

const workers: Worker[] = [];

export function createWorker<TJobData>(
  queueName: string,
  processor: Processor<TJobData>,
  options: WorkerOptions,
): Worker<TJobData> {
  const worker = new Worker<TJobData>(queueName, processor, {
    ...options,
    // Started by startWorkers() so a job queued before a restart can't run before its workflow is initialized.
    autorun: false,
  });
  workers.push(worker);
  return worker;
}

export function startWorkers() {
  for (const worker of workers) {
    worker
      .run()
      .catch((err) =>
        logger.error({ err, queue: worker.name }, '[queue] worker stopped'),
      );
  }
}

export function closeWorkers() {
  return Promise.allSettled(workers.map((worker) => worker.close()));
}

export function createRunQueue<
  TJobData extends { threadId: string; runId?: string },
>({
  queueName,
  concurrency,
  lockDuration,
  maxStalledCount,
  process,
}: {
  queueName: string;
  concurrency: number;
  lockDuration: number;
  maxStalledCount: number;
  process: (data: TJobData, queueWaitMs: number) => Promise<void>;
}): {
  queue: Queue<TJobData> | null;
  worker: Worker<TJobData> | null;
  getStatus: () => Promise<QueueStatus>;
} {
  if (config.mock.queue) {
    return {
      queue: null,
      worker: null,
      getStatus: async () => ({ active: 0, waiting: 0, delayed: 0, jobs: [] }),
    };
  }

  const queue = new Queue<TJobData>(queueName, {
    connection: config.redis.bullmq,
    defaultJobOptions: {
      removeOnComplete: { age: 3 * 24 * 60 * 60, count: 500 }, // 3 days
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 1000 }, // 14 days
    },
  });

  const worker = createWorker<TJobData>(
    queueName,
    (job) =>
      process(
        job.data,
        // Excludes any delay the job was scheduled with — queue wait, not debounce.
        Math.max(0, Date.now() - (job.timestamp + (job.delay ?? 0))),
      ),
    {
      connection: config.redis.bullmq,
      concurrency,
      lockDuration,
      maxStalledCount,
    },
  );

  const getStatus = async (): Promise<QueueStatus> => {
    const [counts, jobs] = await Promise.all([
      queue.getJobCounts('active', 'waiting', 'delayed'),
      queue.getJobs(['active', 'delayed', 'waiting']),
    ]);

    return {
      active: counts.active,
      waiting: counts.waiting,
      delayed: counts.delayed,
      jobs: await Promise.all(
        jobs.map(async (job) => ({
          runId: job.data.runId,
          threadId: job.data.threadId,
          state: await job.getState(),
          ...(job.delay
            ? {
                delayRemaining: Math.max(
                  0,
                  job.timestamp + job.delay - Date.now(),
                ),
              }
            : {}),
        })),
      ),
    };
  };

  return { queue, worker, getStatus };
}
