import { CronExpressionParser } from 'cron-parser';

import type { ScheduleRecurrence } from '#types.js';

export function toCronPattern(recurrence: ScheduleRecurrence): string {
  const [hour, minute] = recurrence.time.split(':');
  switch (recurrence.freq) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${recurrence.daysOfWeek.join(',')}`;
    case 'monthly':
      return `${minute} ${hour} ${recurrence.dayOfMonth} * *`;
  }
}

// BullMQ fires a job scheduler's first job immediately on creation (unconditional since 5.19) — pass this as `startDate` to wait for the real next occurrence instead.
export function firstOccurrence(
  pattern: string,
  tz: string,
  from = new Date(),
): Date {
  return CronExpressionParser.parse(pattern, { currentDate: from, tz })
    .next()
    .toDate();
}
