import type { Static } from 'elysia';

import type { Session, TaskSchedule } from '#types.js';
import { ScheduleStatus } from '#types.js';

import { threadsDal } from '#components/threads/dal.js';
import { schedulesDal } from './dal.js';
import {
  enqueueOneTime,
  getNextRecurrence,
  materializeScheduleRun,
  removeOneTime,
  removeRecurring,
  upsertRecurring,
} from './queue.js';
import { firstOccurrence, toCronPattern } from './recurrence.js';
import type {
  createScheduleSchema,
  updateScheduleSchema,
} from './validation.js';

import { providerUsername } from '#utils/auth.js';
import { errors } from '#utils/errors.js';
import { gitHosts, resolveRepoFromUrl } from '#utils/git-host.js';

type CreateScheduleBody = Static<typeof createScheduleSchema>;
type UpdateScheduleBody = Static<typeof updateScheduleSchema>;

async function requireSchedule(id: string): Promise<TaskSchedule> {
  const schedule = await schedulesDal.findById(id);
  if (!schedule) throw errors.schedules.notFound();
  return schedule;
}

async function arm(schedule: TaskSchedule) {
  if (schedule.recurrence) {
    const pattern = toCronPattern(schedule.recurrence);
    const startDate = firstOccurrence(pattern, schedule.timezone);
    await upsertRecurring(
      schedule.id,
      pattern,
      schedule.timezone,
      startDate,
      schedule.end_date ?? undefined,
    );
  } else {
    await enqueueOneTime(schedule.id, schedule.scheduled_for);
  }
}

async function teardown(schedule: TaskSchedule) {
  await (schedule.recurrence
    ? removeRecurring(schedule.id)
    : removeOneTime(schedule.id));
}

function fieldsFromBody(body: UpdateScheduleBody) {
  const isRecurring = 'recurrence' in body;
  return {
    title: body.title,
    prompt: body.prompt,
    timezone: body.timezone,
    recurrence: isRecurring ? body.recurrence : null,
    scheduled_for: isRecurring ? new Date() : new Date(body.scheduledFor),
    end_date: isRecurring && body.endDate ? new Date(body.endDate) : null,
  };
}

async function decorate(schedule: TaskSchedule) {
  const nextRun =
    schedule.status !== ScheduleStatus.Active
      ? null
      : schedule.recurrence
        ? await getNextRecurrence(schedule.id)
        : schedule.scheduled_for;
  return {
    ...schedule,
    nextRun,
    repoUrl: gitHosts[schedule.provider].repoUrl(schedule.project_path),
  };
}

export const schedulesService = {
  list: async () => {
    const schedules = await schedulesDal.list();
    return Promise.all(schedules.map(decorate));
  },

  getById: async (id: string) => {
    const schedule = await requireSchedule(id);
    const [decorated, runs] = await Promise.all([
      decorate(schedule),
      threadsDal.listByScheduleId(id),
    ]);
    return { ...decorated, runs };
  },

  create: async (body: CreateScheduleBody, session: Session) => {
    const { host, projectPath, defaultBranch } = await resolveRepoFromUrl(
      body.repoUrl,
    );

    const schedule = await schedulesDal.insert({
      ...fieldsFromBody(body),
      provider: host.provider,
      project_path: projectPath,
      default_branch: defaultBranch,
      created_by: providerUsername(session, host.provider),
      status: ScheduleStatus.Active,
    });

    await arm(schedule);
    return schedule;
  },

  // Series-wide only — changes every future occurrence; already-run occurrences are untouched historical thread/run records.
  update: async (id: string, body: UpdateScheduleBody) => {
    const existing = await requireSchedule(id);
    if (existing.status === ScheduleStatus.Cancelled) {
      throw errors.schedules.cancelled();
    }

    if (existing.status === ScheduleStatus.Active) await teardown(existing);

    const updated = await schedulesDal.update(id, fieldsFromBody(body));
    if (!updated) throw errors.schedules.notFound();

    if (updated.status === ScheduleStatus.Active) await arm(updated);
    return updated;
  },

  pause: async (id: string) => {
    const schedule = await requireSchedule(id);
    if (schedule.status !== ScheduleStatus.Active) {
      throw errors.schedules.notActive();
    }
    await teardown(schedule);
    return schedulesDal.update(id, { status: ScheduleStatus.Paused });
  },

  resume: async (id: string) => {
    const schedule = await requireSchedule(id);
    if (schedule.status !== ScheduleStatus.Paused) {
      throw errors.schedules.notPaused();
    }
    const updated = await schedulesDal.update(id, {
      status: ScheduleStatus.Active,
    });
    await arm(updated!);
    return updated;
  },

  cancel: async (id: string) => {
    const schedule = await requireSchedule(id);
    if (schedule.status === ScheduleStatus.Cancelled) {
      throw errors.schedules.cancelled();
    }
    if (schedule.status === ScheduleStatus.Active) await teardown(schedule);
    return schedulesDal.update(id, { status: ScheduleStatus.Cancelled });
  },

  // Out-of-band immediate fire — doesn't touch the schedule's own cadence.
  runNow: async (id: string) => {
    const schedule = await requireSchedule(id);
    if (schedule.status === ScheduleStatus.Cancelled) {
      throw errors.schedules.cancelled();
    }
    return materializeScheduleRun(schedule);
  },
};
