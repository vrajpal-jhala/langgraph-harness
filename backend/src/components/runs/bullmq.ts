import { Queue, Worker } from 'bullmq';

import { config } from '#utils/config.js';

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

  const worker = new Worker<TJobData>(
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
