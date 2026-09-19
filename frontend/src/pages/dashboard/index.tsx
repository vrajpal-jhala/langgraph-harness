import { use, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Anchor,
  Badge,
  Card,
  Group,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';

import type { Queue } from '@/types';
import { RunKind } from '@/types';

import { api } from '@/api';
import { Context } from '@/contexts';

const POLL_INTERVAL_MS = 5000;

const JOB_STATE_COLOR: Record<string, string> = {
  active: 'blue',
  waiting: 'gray',
  delayed: 'yellow',
  completed: 'green',
  failed: 'red',
};

type UserCounts = { total: number; active: number };

const QueueCard = ({
  title,
  queue,
  loading,
  dataTour,
}: {
  title: string;
  queue: Queue | null;
  loading: boolean;
  dataTour?: string;
}) => (
  <Card
    withBorder
    radius="md"
    padding="md"
    className="queue-status-card"
    data-tour={dataTour}
  >
    <Text fw={600} mb="sm">
      {title}
    </Text>

    {loading ? (
      <Skeleton height={80} radius="sm" />
    ) : (
      <>
        <Group gap="xl">
          <Stack gap={0}>
            <Text size="xl" fw={700}>
              {queue?.active ?? 0}
            </Text>
            <Text size="xs" c="dimmed">
              Active
            </Text>
          </Stack>
          <Stack gap={0}>
            <Text size="xl" fw={700}>
              {queue?.waiting ?? 0}
            </Text>
            <Text size="xs" c="dimmed">
              Waiting
            </Text>
          </Stack>
          <Stack gap={0}>
            <Text size="xl" fw={700}>
              {queue?.delayed ?? 0}
            </Text>
            <Text size="xs" c="dimmed">
              Delayed
            </Text>
          </Stack>
        </Group>

        {!!queue?.jobs.length && (
          <ScrollArea.Autosize mah={220} type="hover" mt="md">
            <Stack gap="xs">
              {queue.jobs.map((job, index) => (
                <Group
                  key={job.runId ?? `${job.threadId}-${index}`}
                  justify="space-between"
                  wrap="nowrap"
                  gap="xs"
                >
                  <Anchor
                    component={Link}
                    to={`/threads/${job.threadId}`}
                    size="sm"
                    truncate
                  >
                    Job {index + 1}
                  </Anchor>
                  <Badge
                    color={JOB_STATE_COLOR[job.state] ?? 'gray'}
                    size="sm"
                    tt="capitalize"
                  >
                    {job.state}
                  </Badge>
                </Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </>
    )}
  </Card>
);

const DashboardPage = () => {
  const { handleError } = use(Context);
  const [mrReviewQueue, setMrReviewQueue] = useState<Queue | null>(null);
  const [workItemResolveQueue, setWorkItemResolveQueue] =
    useState<Queue | null>(null);
  const [taskResolveQueue, setTaskResolveQueue] = useState<Queue | null>(null);
  const [loadingQueues, setLoadingQueues] = useState(true);
  const [userCounts, setUserCounts] = useState<UserCounts | null>(null);

  const refresh = useCallback(
    (silent = false) => {
      Promise.all([
        api.queue.get({ query: { kind: RunKind.MrReview } }),
        api.queue.get({ query: { kind: RunKind.WorkItemResolve } }),
        api.queue.get({ query: { kind: RunKind.TaskResolve } }),
        api.users.get(),
      ]).then(([mrReviewRes, workItemResolveRes, taskResolveRes, usersRes]) => {
        if (mrReviewRes.error)
          handleError(mrReviewRes.error.value, 'Failed to fetch queue');
        if (mrReviewRes.data) setMrReviewQueue(mrReviewRes.data);
        if (workItemResolveRes.error)
          handleError(workItemResolveRes.error.value, 'Failed to fetch queue');
        if (workItemResolveRes.data)
          setWorkItemResolveQueue(workItemResolveRes.data);
        if (taskResolveRes.error)
          handleError(taskResolveRes.error.value, 'Failed to fetch queue');
        if (taskResolveRes.data) setTaskResolveQueue(taskResolveRes.data);
        if (usersRes.error)
          handleError(usersRes.error.value, 'Failed to fetch users');
        if (usersRes.data) setUserCounts(usersRes.data);
        if (!silent) setLoadingQueues(false);
      });
    },
    [handleError],
  );

  useEffect(() => {
    refresh();
    const interval = setInterval(() => refresh(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <Stack className="dashboard-page" gap="md">
      <Title order={2} visibleFrom="sm">
        Dashboard
      </Title>

      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
        <Card withBorder radius="md" padding="md" miw={140}>
          <Text fw={600} mb="sm">
            Users
          </Text>
          {loadingQueues ? (
            <Skeleton height={32} width={80} radius="sm" />
          ) : (
            <Group gap="xl">
              <Stack gap={0}>
                <Text size="xl" fw={700}>
                  {userCounts?.active ?? 0}
                </Text>
                <Text size="xs" c="dimmed">
                  Active
                </Text>
              </Stack>
              <Stack gap={0}>
                <Text size="xl" fw={700}>
                  {userCounts?.total ?? 0}
                </Text>
                <Text size="xs" c="dimmed">
                  Total
                </Text>
              </Stack>
            </Group>
          )}
        </Card>

        <QueueCard
          title="MR Review Queue"
          queue={mrReviewQueue}
          loading={loadingQueues}
          dataTour="dashboard-queue"
        />
        <QueueCard
          title="Work Item Resolve Queue"
          queue={workItemResolveQueue}
          loading={loadingQueues}
        />
        <QueueCard
          title="Task Resolve Queue"
          queue={taskResolveQueue}
          loading={loadingQueues}
        />
      </SimpleGrid>
    </Stack>
  );
};

export default DashboardPage;
