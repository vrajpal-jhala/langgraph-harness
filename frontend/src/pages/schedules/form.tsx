import { use, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Chip,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DateInput, DateTimePicker, TimeInput } from '@mantine/dates';
import {
  IconCalendarClock,
  IconClock,
  IconInfoCircle,
  IconPlayerPlay,
} from '@tabler/icons-react';

import type { ScheduleRecurrence, TaskSchedule } from '@/types';

import Icon from '@/components/icon';
import { describeRecurrence } from './recurrence';

import { api } from '@/api';
import { Context } from '@/contexts';

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DAY_OPTIONS = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
  { value: '0', label: 'Sun' },
];

type When = 'now' | 'once' | 'recurring';
type Freq = ScheduleRecurrence['freq'];

export const ScheduleForm = ({ schedule }: { schedule?: TaskSchedule }) => {
  const isEdit = !!schedule;
  const recurrenceIn = schedule?.recurrence;
  const navigate = useNavigate();
  const { handleError } = use(Context);
  const [title, setTitle] = useState(schedule?.title ?? '');
  const [repoUrl, setRepoUrl] = useState(schedule?.repoUrl ?? '');
  const [prompt, setPrompt] = useState(schedule?.prompt ?? '');
  const [when, setWhen] = useState<When>(
    !schedule ? 'now' : recurrenceIn ? 'recurring' : 'once',
  );
  const [scheduledFor, setScheduledFor] = useState<Date | null>(
    schedule && !recurrenceIn ? new Date(schedule.scheduled_for) : null,
  );
  const [freq, setFreq] = useState<Freq>(recurrenceIn?.freq ?? 'daily');
  const [time, setTime] = useState(recurrenceIn?.time ?? '09:00');
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>(
    recurrenceIn?.freq === 'weekly'
      ? recurrenceIn.daysOfWeek.map(String)
      : ['1'],
  );
  const [dayOfMonth, setDayOfMonth] = useState<number>(
    recurrenceIn?.freq === 'monthly' ? recurrenceIn.dayOfMonth : 1,
  );
  const [endDate, setEndDate] = useState<Date | null>(
    schedule?.end_date ? new Date(schedule.end_date) : null,
  );
  const [submitting, setSubmitting] = useState(false);

  const recurrence: ScheduleRecurrence =
    freq === 'weekly'
      ? { freq, time, daysOfWeek: daysOfWeek.map(Number) }
      : freq === 'monthly'
        ? { freq, time, dayOfMonth }
        : { freq, time };

  const canSubmit =
    !!title.trim() &&
    !!repoUrl.trim() &&
    !!prompt.trim() &&
    (when !== 'once' || !!scheduledFor) &&
    (when !== 'recurring' || freq !== 'weekly' || daysOfWeek.length > 0);

  const handleSubmit = async () => {
    setSubmitting(true);

    if (when === 'now') {
      const { data, error } = await api['task-resolve'].post({
        title: title.trim(),
        repoUrl: repoUrl.trim(),
        prompt: prompt.trim(),
      });
      setSubmitting(false);
      if (error) return handleError(error.value, 'Failed to start task');
      return navigate(`/threads/${data.thread.id}`);
    }

    const body =
      when === 'once'
        ? {
            title: title.trim(),
            repoUrl: repoUrl.trim(),
            prompt: prompt.trim(),
            timezone: TIMEZONE,
            scheduledFor: scheduledFor!.toISOString(),
          }
        : {
            title: title.trim(),
            repoUrl: repoUrl.trim(),
            prompt: prompt.trim(),
            timezone: TIMEZONE,
            recurrence,
            endDate: endDate?.toISOString(),
          };

    const { error } = isEdit
      ? await api.schedules({ id: schedule.id }).patch(body)
      : await api.schedules.post(body);

    setSubmitting(false);
    if (error) {
      return handleError(
        error.value,
        isEdit ? 'Failed to update schedule' : 'Failed to create schedule',
      );
    }
    navigate('/schedules');
  };

  return (
    <Stack gap="md">
      <TextInput
        label="Title"
        placeholder="Add a health check endpoint"
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
      />

      <TextInput
        label="Repository"
        placeholder="https://gitlab.com/group/project"
        value={repoUrl}
        onChange={(e) => setRepoUrl(e.currentTarget.value)}
      />

      <Textarea
        label="What should langgraph-harness do?"
        description="Plain instructions. The agent works in a sandboxed checkout and opens a draft merge request."
        placeholder="Add a health check endpoint that reports database connectivity."
        autosize
        minRows={5}
        maxRows={16}
        value={prompt}
        onChange={(e) => setPrompt(e.currentTarget.value)}
      />

      <Stack gap="xs">
        <Text size="sm" fw={500}>
          When
        </Text>
        <Chip.Group value={when} onChange={(v) => setWhen(v as When)}>
          <Group gap="xs">
            {!isEdit && <Chip value="now">Now</Chip>}
            <Chip value="once">One-time</Chip>
            <Chip value="recurring">Recurring</Chip>
          </Group>
        </Chip.Group>
      </Stack>

      {when === 'once' && (
        <DateTimePicker
          label="Run at"
          placeholder="Pick date and time"
          value={scheduledFor}
          onChange={(v) => setScheduledFor(v ? new Date(v) : null)}
          minDate={new Date()}
          valueFormat="DD MMM YYYY, HH:mm"
        />
      )}

      {when === 'recurring' && (
        <Stack gap="sm">
          <Group grow align="flex-end">
            <Select
              label="Repeats"
              value={freq}
              onChange={(v) => v && setFreq(v as Freq)}
              data={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
              allowDeselect={false}
            />
            <TimeInput
              label="At"
              leftSection={<Icon as={IconClock} size={16} />}
              value={time}
              onChange={(e) => setTime(e.currentTarget.value)}
            />
          </Group>

          {freq === 'weekly' && (
            <Chip.Group multiple value={daysOfWeek} onChange={setDaysOfWeek}>
              <Group gap="xs">
                {DAY_OPTIONS.map((d) => (
                  <Chip key={d.value} value={d.value} size="xs">
                    {d.label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          )}

          {freq === 'monthly' && (
            <NumberInput
              label="Day of month"
              value={dayOfMonth}
              onChange={(v) => setDayOfMonth(Number(v) || 1)}
              min={1}
              max={28}
            />
          )}

          <DateInput
            label="End date (optional)"
            placeholder="No end date"
            value={endDate}
            onChange={(v) => setEndDate(v ? new Date(v) : null)}
            minDate={new Date()}
            clearable
          />

          <Text size="xs" c="dimmed">
            {describeRecurrence(recurrence)} ({TIMEZONE})
          </Text>
        </Stack>
      )}

      <Group justify="flex-end">
        <Button
          leftSection={
            <Icon as={when === 'now' ? IconPlayerPlay : IconCalendarClock} />
          }
          onClick={handleSubmit}
          loading={submitting}
          disabled={!canSubmit}
        >
          {when === 'now'
            ? 'Run task'
            : isEdit
              ? 'Save changes'
              : 'Create schedule'}
        </Button>
      </Group>

      <Alert color="blue" icon={<Icon as={IconInfoCircle} />}>
        Once the draft MR is open, comment on it mentioning the bot to send a
        follow-up — each comment runs again against the same branch.
      </Alert>
    </Stack>
  );
};
