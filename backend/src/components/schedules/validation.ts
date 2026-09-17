import { t } from 'elysia';

const repoUrlSchema = t.String({ minLength: 1, maxLength: 2048 });
const titleSchema = t.String({ minLength: 1, maxLength: 200 });
const promptSchema = t.String({ minLength: 1, maxLength: 20_000 });
const timezoneSchema = t.String({ minLength: 1, maxLength: 100 });
// 24-hour "HH:mm" — matches the native <input type="time"> value format Mantine's TimeInput sends.
const timeSchema = t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });

const recurrenceSchema = t.Union([
  t.Object({ freq: t.Literal('daily'), time: timeSchema }),
  t.Object({
    freq: t.Literal('weekly'),
    time: timeSchema,
    daysOfWeek: t.Array(t.Integer({ minimum: 0, maximum: 6 }), {
      minItems: 1,
    }),
  }),
  t.Object({
    freq: t.Literal('monthly'),
    time: timeSchema,
    dayOfMonth: t.Integer({ minimum: 1, maximum: 28 }),
  }),
]);

const oneTimeScheduleSchema = t.Object({
  title: titleSchema,
  repoUrl: repoUrlSchema,
  prompt: promptSchema,
  timezone: timezoneSchema,
  // ISO instant, already converted to UTC client-side — timezone is irrelevant past this point.
  scheduledFor: t.String({ format: 'date-time' }),
});

const recurringScheduleSchema = t.Object({
  title: titleSchema,
  repoUrl: repoUrlSchema,
  prompt: promptSchema,
  timezone: timezoneSchema,
  recurrence: recurrenceSchema,
  endDate: t.Optional(t.String({ format: 'date-time' })),
});

export const createScheduleSchema = t.Union([
  oneTimeScheduleSchema,
  recurringScheduleSchema,
]);

export const updateScheduleSchema = createScheduleSchema;
