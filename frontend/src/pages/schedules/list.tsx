import { use, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionIcon,
  Badge,
  Card,
  Center,
  EmptyState,
  Group,
  Indicator,
  Menu,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconBolt,
  IconCalendarClock,
  IconChevronDown,
  IconChevronUp,
  IconDotsVertical,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconX,
} from '@tabler/icons-react';

import { type RunStatus, ScheduleStatus, type TaskSchedule } from '@/types';

import Icon from '@/components/icon';
import { describeRecurrence } from './recurrence';

import { api } from '@/api';
import { RUN_STATUS_COLOR } from '@/constants';
import { Context } from '@/contexts';
import { useConfirmAction } from '@/hooks/useConfirmAction';
import { formatDate } from '@/utils';

const STATUS_COLOR: Record<ScheduleStatus, string> = {
  [ScheduleStatus.Active]: 'green',
  [ScheduleStatus.Paused]: 'yellow',
  [ScheduleStatus.Cancelled]: 'gray',
  [ScheduleStatus.Completed]: 'blue',
};

type RunHistoryThread = {
  id: string;
  title: string;
  latest_run_status: RunStatus | null;
  created_at: Date;
};

const RunHistory = ({ scheduleId }: { scheduleId: string }) => {
  const [runs, setRuns] = useState<RunHistoryThread[] | null>(null);
  const { handleError } = use(Context);

  useEffect(() => {
    api
      .schedules({ id: scheduleId })
      .get()
      .then(({ data, error }) => {
        if (error)
          return handleError(error.value, 'Failed to load run history');
        setRuns(data.runs);
      });
  }, [scheduleId, handleError]);

  if (!runs) return <Skeleton height={32} radius="sm" />;
  if (!runs.length)
    return (
      <Text size="sm" c="dimmed">
        No runs yet.
      </Text>
    );

  return (
    <ScrollArea.Autosize mah={240}>
      <Stack gap={4}>
        {runs.map((run) => {
          const created = formatDate(run.created_at);
          return (
            <Group key={run.id} gap="xs" wrap="nowrap">
              {run.latest_run_status && (
                <Tooltip label={run.latest_run_status} tt="capitalize">
                  <Indicator
                    variant="dot"
                    color={RUN_STATUS_COLOR[run.latest_run_status]}
                    size={6}
                  />
                </Tooltip>
              )}
              <Text
                component={Link}
                to={`/threads/${run.id}`}
                size="sm"
                className="schedule-run-link"
              >
                {created ? created.display : 'View run'}
              </Text>
            </Group>
          );
        })}
      </Stack>
    </ScrollArea.Autosize>
  );
};

const ScheduleCard = ({
  schedule,
  canManage,
  onChange,
}: {
  schedule: TaskSchedule;
  canManage: boolean;
  onChange: () => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const { handleError } = use(Context);
  const cancelSchedule = useConfirmAction<TaskSchedule>({
    title: 'Cancel schedule',
    message: (target) =>
      `Cancel "${target?.title}"? This can't be undone — the schedule will never fire again.`,
    confirmLabel: 'Cancel schedule',
    destructive: true,
  });

  const runAction = async (
    action: Promise<{ error: { value: unknown } | null }>,
  ) => {
    setBusy(true);
    const { error } = await action;
    setBusy(false);
    if (error) return handleError(error.value, 'Action failed');
    onChange();
  };

  const nextRun = formatDate(schedule.nextRun);
  const canEdit =
    schedule.status !== ScheduleStatus.Cancelled &&
    schedule.status !== ScheduleStatus.Completed;
  const canCancel = canEdit;
  const canPauseResume =
    !!schedule.recurrence &&
    (schedule.status === ScheduleStatus.Active ||
      schedule.status === ScheduleStatus.Paused);

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2}>
            <Text fw={500}>{schedule.title}</Text>
            <Text size="xs" c="dimmed">
              {schedule.project_path}
            </Text>
          </Stack>
          <Badge color={STATUS_COLOR[schedule.status]}>{schedule.status}</Badge>
        </Group>

        <Group gap="xs" align="center" wrap="nowrap">
          <Icon as={IconCalendarClock} size={12} />
          <Text size="sm" c="dimmed">
            {schedule.recurrence
              ? describeRecurrence(schedule.recurrence)
              : 'One-time'}
          </Text>
        </Group>

        {nextRun && (
          <Tooltip label={nextRun.full}>
            <Text size="sm">
              {schedule.recurrence ? 'Next' : 'Scheduled for'}:{' '}
              {nextRun.display}
            </Text>
          </Tooltip>
        )}

        <Group
          justify={schedule.recurrence ? 'space-between' : 'flex-end'}
          wrap="nowrap"
        >
          {schedule.recurrence && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
            >
              <Icon as={expanded ? IconChevronUp : IconChevronDown} />
            </ActionIcon>
          )}

          {canManage && (
            <Group gap="xs">
              <Tooltip label="Run now">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  loading={busy}
                  disabled={schedule.status === ScheduleStatus.Cancelled}
                  onClick={() =>
                    runAction(
                      api.schedules({ id: schedule.id })['run-now'].post(),
                    )
                  }
                >
                  <Icon as={IconBolt} />
                </ActionIcon>
              </Tooltip>
              {(canEdit || canPauseResume || canCancel) && (
                <Menu withinPortal position="bottom-end" shadow="sm">
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" loading={busy}>
                      <Icon as={IconDotsVertical} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {canEdit && (
                      <Menu.Item
                        component={Link}
                        to={`/schedules/${schedule.id}`}
                        leftSection={<Icon as={IconPencil} size={16} />}
                      >
                        Edit
                      </Menu.Item>
                    )}
                    {canPauseResume &&
                      (schedule.status === ScheduleStatus.Active ? (
                        <Menu.Item
                          leftSection={<Icon as={IconPlayerPause} size={16} />}
                          onClick={() =>
                            runAction(
                              api.schedules({ id: schedule.id }).pause.post(),
                            )
                          }
                        >
                          Pause
                        </Menu.Item>
                      ) : (
                        <Menu.Item
                          leftSection={<Icon as={IconPlayerPlay} size={16} />}
                          onClick={() =>
                            runAction(
                              api.schedules({ id: schedule.id }).resume.post(),
                            )
                          }
                        >
                          Resume
                        </Menu.Item>
                      ))}
                    {canCancel && (
                      <Menu.Item
                        color="red"
                        leftSection={<Icon as={IconX} size={16} />}
                        onClick={() =>
                          cancelSchedule.request(
                            () =>
                              runAction(
                                api
                                  .schedules({ id: schedule.id })
                                  .cancel.post(),
                              ),
                            schedule,
                          )
                        }
                      >
                        Cancel
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          )}
        </Group>

        {schedule.recurrence
          ? expanded && <RunHistory scheduleId={schedule.id} />
          : schedule.status === ScheduleStatus.Completed && (
              <RunHistory scheduleId={schedule.id} />
            )}
      </Stack>
      {cancelSchedule.modal}
    </Card>
  );
};

const SchedulesList = ({ canManage }: { canManage: boolean }) => {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<TaskSchedule[]>([]);
  const { handleError } = use(Context);

  const load = () => {
    api.schedules.get().then(({ data, error }) => {
      setLoading(false);
      if (error) return handleError(error.value, 'Failed to load schedules');
      setSchedules(data);
    });
  };

  useEffect(load, [handleError]);

  if (loading) {
    return (
      <Stack gap="xs">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={92} radius="md" />
        ))}
      </Stack>
    );
  }

  if (!schedules.length) {
    return (
      <Center className="schedules-empty">
        <EmptyState
          icon={<Icon as={IconCalendarClock} size={40} />}
          title="No schedules yet"
          description="Scheduled tasks appear here once you create one."
          size="md"
        />
      </Center>
    );
  }

  return (
    <Stack gap="sm">
      {schedules.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          canManage={canManage}
          onChange={load}
        />
      ))}
    </Stack>
  );
};

export default SchedulesList;
