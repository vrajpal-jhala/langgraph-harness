import { Queue, Worker } from 'bullmq';

import type { TaskResolveRunInput, TaskSchedule } from '#types.js';
import { RunKind, ScheduleStatus } from '#types.js';

import { runsService } from '#components/runs/service.js';
import { threadsDal } from '#components/threads/dal.js';
import { threadsService } from '#components/threads/service.js';
import { enqueueTaskResolve } from '#components/workflows/task-resolve/queue.js';
import { schedulesDal } from './dal.js';
import { firstOccurrence, toCronPattern } from './recurrence.js';

import { config, llms } from '#utils/config.js';
import { parseHarnessYml } from '#utils/harness-config.js';
import { logger } from '#utils/logger.js';

const QUEUE_NAME = 'task-schedule';
const JOB_NAME = 'task-schedule-fire';

type ScheduleJob = { scheduleId: string };

async function buildRunInput(
  schedule: TaskSchedule,
): Promise<TaskResolveRunInput> {
  return {
    kind: RunKind.TaskResolve,
    title: schedule.title,
    projectPath: schedule.project_path,
    prompt: schedule.prompt,
    defaultBranch: schedule.default_branch,
    submittedBy: schedule.created_by,
    model: llms.find((m) => m.isDefault)?.model ?? llms[0].model,
    config: await parseHarnessYml(schedule.project_path),
  };
}

// Shared by a timer fire and "Run now" — both just materialize one more task-resolve run from the schedule's stored config.
export async function materializeScheduleRun(schedule: TaskSchedule) {
  const thread = await threadsService.create(
    schedule.title,
    RunKind.TaskResolve,
    schedule.created_by,
  );
  await threadsDal.mergeMetadata(thread.id, {
    scheduleId: schedule.id,
    project: schedule.project_path,
  });

  const input = await buildRunInput(schedule);
  const run = await runsService.create(thread.id, RunKind.TaskResolve, input);
  await enqueueTaskResolve({ threadId: thread.id, runId: run.id, ...input });

  return { thread, run };
}

function isExhausted(schedule: TaskSchedule): boolean {
  if (!schedule.recurrence) return true;
  if (!schedule.end_date) return false;
  return (
    firstOccurrence(toCronPattern(schedule.recurrence), schedule.timezone) >
    schedule.end_date
  );
}

async function processScheduleFire({ scheduleId }: ScheduleJob) {
  const schedule = await schedulesDal.findById(scheduleId);
  // Closes the race between a cancel/pause and a job already sitting in Redis waiting to fire.
  if (!schedule || schedule.status !== ScheduleStatus.Active) return;
  await materializeScheduleRun(schedule);
  if (isExhausted(schedule)) {
    await schedulesDal.update(scheduleId, {
      status: ScheduleStatus.Completed,
    });
  }
}

const taskScheduleQueue = config.mock.queue
  ? null
  : new Queue<ScheduleJob>(QUEUE_NAME, { connection: config.redis.bullmq });

if (!config.mock.queue) {
  const worker = new Worker<ScheduleJob>(
    QUEUE_NAME,
    (job) => processScheduleFire(job.data),
    { connection: config.redis.bullmq, concurrency: 5 },
  );
  worker.on('failed', (job, err) =>
    logger.error(
      { err, scheduleId: job?.data.scheduleId },
      '[task-schedule-worker] fire failed',
    ),
  );
}

// Mock mode has no BullMQ worker to fire jobs, and a schedule can't just run inline now — so use plain timers instead.
const mockTimers = new Map<string, NodeJS.Timeout>();
const mockNextFire = new Map<string, Date>();

function mockFire(scheduleId: string) {
  mockTimers.delete(scheduleId);
  mockNextFire.delete(scheduleId);
  processScheduleFire({ scheduleId }).catch((err) =>
    logger.error({ err, scheduleId }, '[mock-queue] schedule fire failed'),
  );
}

function mockScheduleRecurring(
  scheduleId: string,
  pattern: string,
  tz: string,
  next: Date,
  endDate?: Date,
) {
  if (endDate && next > endDate) return;
  mockNextFire.set(scheduleId, next);
  const timer = setTimeout(
    () => {
      mockFire(scheduleId);
      mockScheduleRecurring(
        scheduleId,
        pattern,
        tz,
        firstOccurrence(pattern, tz, next),
        endDate,
      );
    },
    Math.max(0, next.getTime() - Date.now()),
  );
  mockTimers.set(scheduleId, timer);
}

function mockCancel(scheduleId: string) {
  clearTimeout(mockTimers.get(scheduleId));
  mockTimers.delete(scheduleId);
  mockNextFire.delete(scheduleId);
}

export async function enqueueOneTime(scheduleId: string, fireAt: Date) {
  if (!taskScheduleQueue) {
    mockCancel(scheduleId);
    mockTimers.set(
      scheduleId,
      setTimeout(
        () => mockFire(scheduleId),
        Math.max(0, fireAt.getTime() - Date.now()),
      ),
    );
    return;
  }
  await taskScheduleQueue.add(
    JOB_NAME,
    { scheduleId },
    { jobId: scheduleId, delay: Math.max(0, fireAt.getTime() - Date.now()) },
  );
}

export async function upsertRecurring(
  scheduleId: string,
  pattern: string,
  tz: string,
  startDate: Date,
  endDate?: Date,
) {
  if (!taskScheduleQueue) {
    mockCancel(scheduleId);
    mockScheduleRecurring(scheduleId, pattern, tz, startDate, endDate);
    return;
  }
  await taskScheduleQueue.upsertJobScheduler(
    scheduleId,
    {
      pattern,
      tz,
      // -1ms: BullMQ's next-run calc excludes an exact-match startDate, skipping a full cycle.
      startDate: new Date(startDate.getTime() - 1),
      ...(endDate && { endDate }),
    },
    { name: JOB_NAME, data: { scheduleId } },
  );
}

export async function removeOneTime(scheduleId: string) {
  if (!taskScheduleQueue) return mockCancel(scheduleId);
  await taskScheduleQueue.remove(scheduleId);
}

export async function removeRecurring(scheduleId: string) {
  if (!taskScheduleQueue) return mockCancel(scheduleId);
  await taskScheduleQueue.removeJobScheduler(scheduleId);
}

// Recurring schedules only — a one-time schedule's next (and only) run is just its own `scheduled_for`.
export async function getNextRecurrence(
  scheduleId: string,
): Promise<Date | null> {
  if (!taskScheduleQueue) return mockNextFire.get(scheduleId) ?? null;
  const scheduler = await taskScheduleQueue.getJobScheduler(scheduleId);
  return scheduler?.next ? new Date(scheduler.next) : null;
}
