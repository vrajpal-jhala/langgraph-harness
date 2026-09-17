import { use, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Box,
  Card,
  Center,
  EmptyState,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconGitBranch, IconHierarchy2 } from '@tabler/icons-react';

import type { Workflow } from '@/types';

import Icon from '@/components/icon';

import { api } from '@/api';
import { WORKFLOW_STATUS_COLOR } from '@/constants';
import { Context } from '@/contexts';
import { formatDate } from '@/utils';

const WorkflowsPage = () => {
  const navigate = useNavigate();
  const { handleError } = use(Context);
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  const fetchWorkflows = useCallback(() => {
    api.workflows.get().then(({ data, error }) => {
      if (error) {
        handleError(error.value, 'Failed to fetch workflows');
      }
      if (data) setWorkflows(data);
      setLoading(false);
    });
  }, [handleError]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  return (
    <Stack className="workflows-page" gap="md" h="var(--app-shell-main-height)">
      <Title order={2} visibleFrom="sm">
        Workflows
      </Title>

      <Box data-tour="workflows-grid">
        {loading ? (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={120} radius="md" />
            ))}
          </SimpleGrid>
        ) : !workflows.length ? (
          <Center className="workflow-empty">
            <EmptyState
              icon={<Icon as={IconHierarchy2} size={40} />}
              title="No workflows yet"
              description="Workflows will appear here once configured."
              size="md"
            />
          </Center>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {workflows.map((workflow) => {
              const lastRun = formatDate(workflow.lastRunAt);
              return (
                <Card
                  key={workflow.id}
                  withBorder
                  radius="md"
                  padding="md"
                  className="workflow-card"
                  onClick={() => navigate(`/workflows/${workflow.id}`)}
                >
                  <Group justify="space-between" wrap="nowrap" gap="xs" mb="xs">
                    <Group
                      gap="xs"
                      wrap="nowrap"
                      className="workflow-card__title"
                    >
                      <Icon as={IconGitBranch} size={20} />
                      <Text size="sm" fw={500} className="workflow-card__name">
                        {workflow.name}
                      </Text>
                    </Group>
                    <Badge
                      color={WORKFLOW_STATUS_COLOR[workflow.status]}
                      size="sm"
                      tt="capitalize"
                    >
                      {workflow.status}
                    </Badge>
                  </Group>
                  <Text
                    size="xs"
                    c="dimmed"
                    className="workflow-card__description"
                  >
                    {workflow.description}
                  </Text>
                  <Group gap="lg" mt="md">
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        Total runs
                      </Text>
                      <Text size="sm">{workflow.totalRuns}</Text>
                    </Stack>
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        Active
                      </Text>
                      <Text size="sm">{workflow.activeRuns}</Text>
                    </Stack>
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        Last run
                      </Text>
                      {lastRun ? (
                        <Tooltip label={lastRun.full}>
                          <Text size="sm">{lastRun.display}</Text>
                        </Tooltip>
                      ) : (
                        <Text size="sm">—</Text>
                      )}
                    </Stack>
                  </Group>
                </Card>
              );
            })}
          </SimpleGrid>
        )}
      </Box>
    </Stack>
  );
};

export default WorkflowsPage;
