import { use, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Card,
  Group,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';

import { Role } from '@/types';

import { api } from '@/api';
import { Context } from '@/contexts';
import { useAuth } from '@/hooks/useAuth';

type StackContainers = NonNullable<
  Awaited<
    ReturnType<(typeof api.monitoring)['stack-containers']['get']>
  >['data']
>;
type SandboxFleet = NonNullable<
  Awaited<ReturnType<(typeof api.monitoring)['sandbox-fleet']['get']>>['data']
>;
type DiskUsageBytes = NonNullable<
  Awaited<ReturnType<(typeof api.monitoring)['disk-usage']['get']>>['data']
>;

const DISK_LABELS: Record<keyof DiskUsageBytes, string> = {
  postgres: 'Postgres (data + database size)',
  redis: 'Redis',
  supermemory: 'Supermemory',
  opensandbox: 'OpenSandbox',
  app: 'App (repositories + worktrees)',
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

const MonitoringPage = () => {
  const { user } = useAuth();
  const { handleError } = use(Context);

  const [stackContainers, setStackContainers] =
    useState<StackContainers | null>(null);
  const [stackContainersLoading, setStackContainersLoading] = useState(true);

  const [sandboxFleet, setSandboxFleet] = useState<SandboxFleet | null>(null);
  const [sandboxFleetLoading, setSandboxFleetLoading] = useState(true);

  const [diskUsageBytes, setDiskUsageBytes] = useState<DiskUsageBytes | null>(
    null,
  );
  const [diskUsageLoading, setDiskUsageLoading] = useState(true);

  useEffect(() => {
    api.monitoring['stack-containers'].get().then(({ data, error }) => {
      if (error) handleError(error.value, 'Failed to fetch container stats');
      if (data) setStackContainers(data);
      setStackContainersLoading(false);
    });
  }, [handleError]);

  useEffect(() => {
    api.monitoring['sandbox-fleet'].get().then(({ data, error }) => {
      if (error) handleError(error.value, 'Failed to fetch sandbox fleet');
      if (data) setSandboxFleet(data);
      setSandboxFleetLoading(false);
    });
  }, [handleError]);

  useEffect(() => {
    api.monitoring['disk-usage'].get().then(({ data, error }) => {
      if (error) handleError(error.value, 'Failed to fetch disk usage');
      if (data) setDiskUsageBytes(data);
      setDiskUsageLoading(false);
    });
  }, [handleError]);

  if (user?.role !== Role.Admin) return <Navigate to="/threads" replace />;

  return (
    <Stack className="monitoring-page" gap="md">
      <Title order={2} visibleFrom="sm">
        Monitoring
      </Title>

      <Card withBorder radius="md" padding="md">
        <Text fw={600} mb="sm">
          Sandbox fleet
        </Text>
        {sandboxFleetLoading ? (
          <Skeleton height={60} radius="sm" />
        ) : (
          sandboxFleet && (
            <>
              <Group gap="xl">
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {sandboxFleet.count}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Running
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {sandboxFleet.cpuUsedPercentageTotal.toFixed(0)}%
                  </Text>
                  <Text size="xs" c="dimmed">
                    Total CPU
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {formatBytes(sandboxFleet.memoryUsedMiBTotal * 1024 * 1024)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Total memory
                  </Text>
                </Stack>
              </Group>
              {sandboxFleet.reachableCount < sandboxFleet.count && (
                <Text size="xs" c="orange" mt="xs">
                  Only {sandboxFleet.reachableCount} of {sandboxFleet.count}{' '}
                  running sandboxes reported metrics — totals above exclude the
                  rest.
                </Text>
              )}
            </>
          )
        )}
      </Card>

      <Card withBorder radius="md" padding="md">
        <Text fw={600} mb="sm">
          Compose stack
        </Text>
        {stackContainersLoading ? (
          <Skeleton height={180} radius="sm" />
        ) : (
          stackContainers && (
            <Table withRowBorders={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Container</Table.Th>
                  <Table.Th>CPU</Table.Th>
                  <Table.Th>Memory</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {stackContainers.map((container) => (
                  <Table.Tr key={container.name}>
                    <Table.Td>{container.name}</Table.Td>
                    {container.error ? (
                      <Table.Td colSpan={2}>
                        <Text size="sm" c="dimmed">
                          Unavailable ({container.error})
                        </Text>
                      </Table.Td>
                    ) : (
                      <>
                        <Table.Td>{container.cpuPercent.toFixed(1)}%</Table.Td>
                        <Table.Td>
                          {formatBytes(container.memoryUsedBytes)} /{' '}
                          {formatBytes(container.memoryLimitBytes)}
                        </Table.Td>
                      </>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )
        )}
      </Card>

      <Card withBorder radius="md" padding="md">
        <Text fw={600} mb="sm">
          Disk usage
        </Text>
        {diskUsageLoading ? (
          <Skeleton height={140} radius="sm" />
        ) : (
          diskUsageBytes && (
            <Table withRowBorders={false}>
              <Table.Tbody>
                {(
                  Object.keys(diskUsageBytes) as Array<keyof DiskUsageBytes>
                ).map((dir) => (
                  <Table.Tr key={dir}>
                    <Table.Td>{DISK_LABELS[dir]}</Table.Td>
                    <Table.Td>{formatBytes(diskUsageBytes[dir])}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )
        )}
      </Card>
    </Stack>
  );
};

export default MonitoringPage;
