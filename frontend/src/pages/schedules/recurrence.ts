import type { ScheduleRecurrence } from '@/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime(time: string): string {
  return new Date(`1970-01-01T${time}:00`).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ordinal(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
  return `${n}th`;
}

export function describeRecurrence(recurrence: ScheduleRecurrence): string {
  const time = formatTime(recurrence.time);
  switch (recurrence.freq) {
    case 'daily':
      return `Daily at ${time}`;
    case 'weekly':
      return `Weekly on ${recurrence.daysOfWeek
        .slice()
        .sort()
        .map((d) => DAY_NAMES[d])
        .join(', ')} at ${time}`;
    case 'monthly':
      return `Monthly on the ${ordinal(recurrence.dayOfMonth)} at ${time}`;
  }
}
