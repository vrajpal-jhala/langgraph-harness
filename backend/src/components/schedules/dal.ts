import type {
  NewTaskSchedule,
  TaskSchedule,
  TaskScheduleUpdate,
} from '#types.js';

import { db } from '#utils/db.js';

export const schedulesDal = {
  insert: async (values: NewTaskSchedule): Promise<TaskSchedule> =>
    db
      .insertInto('task_schedules')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow(),

  findById: async (id: string): Promise<TaskSchedule | undefined> =>
    db
      .selectFrom('task_schedules')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst(),

  list: async (): Promise<TaskSchedule[]> =>
    db
      .selectFrom('task_schedules')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute(),

  update: async (
    id: string,
    values: TaskScheduleUpdate,
  ): Promise<TaskSchedule | undefined> =>
    db
      .updateTable('task_schedules')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst(),
};
