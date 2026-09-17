import { use, useEffect, useState } from 'react';
import { LineChart } from '@mantine/charts';
import {
  Button,
  Card,
  Center,
  Divider,
  EmptyState,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChartBar, IconHelpCircle } from '@tabler/icons-react';

import { RunKind } from '@/types';

import Icon from '@/components/icon';

import { api } from '@/api';
import { Context } from '@/contexts';
import { formatDuration } from '@/utils';

const REPOS_PER_PAGE = 20;

type Overview = NonNullable<
  Awaited<ReturnType<typeof api.analytics.overview.get>>['data']
>;
type Usage = NonNullable<
  Awaited<ReturnType<typeof api.analytics.usage.get>>['data']
>;
type RepoRow = NonNullable<
  Awaited<ReturnType<(typeof api.analytics)['by-repo']['get']>>['data']
>['repos'][number];
type TrendPoint = NonNullable<
  Awaited<ReturnType<typeof api.analytics.trend.get>>['data']
>[number];

const KIND_OPTIONS = [
  { label: 'Reviews', value: RunKind.MrReview },
  { label: 'Chat', value: RunKind.Chat },
  { label: 'Work Items', value: RunKind.WorkItemResolve },
  { label: 'Tasks', value: RunKind.TaskResolve },
];

const commonNudges = [
  { key: 'DuplicateCallGuard', label: 'Duplicate call guard' },
  { key: 'TrailingQuestionGuard', label: 'Trailing question guard' },
  { key: 'NoToolCallGuard', label: 'No tool call guard' },
  { key: 'ExtractProjectMemory', label: 'Memory extraction nudge' },
];

// task-resolve runs the same agent middleware stack as work-item-resolve.
const sandboxedResolveNudges = [
  ...commonNudges,
  { key: 'DiscussionCheckGuard', label: 'Discussion check guard' },
];

const NUDGE_MIDDLEWARES: Record<RunKind, { key: string; label: string }[]> = {
  [RunKind.MrReview]: commonNudges,
  [RunKind.Chat]: [{ key: 'HumanApproval', label: 'Human approval' }],
  [RunKind.WorkItemResolve]: sandboxedResolveNudges,
  [RunKind.TaskResolve]: sandboxedResolveNudges,
};

// A label/value row inside a card — every stat here is one of these, never a bare number alone.
const Stat = ({
  label,
  value,
  c,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  c?: string;
  tooltip?: string;
}) => (
  <Group justify="space-between" gap="xl" wrap="nowrap">
    <Group gap={4} wrap="nowrap">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      {tooltip && (
        <Tooltip label={tooltip} multiline w={220}>
          <Icon as={IconHelpCircle} size={12} />
        </Tooltip>
      )}
    </Group>
    <Text size="sm" fw={600} c={c}>
      {value}
    </Text>
  </Group>
);

const dash = (
  value: number | null | undefined,
  format?: (n: number) => string,
) =>
  value === null || value === undefined
    ? '—'
    : (format?.(value) ?? String(value));

const formatChartDate = (label: unknown) => {
  const d = label instanceof Date ? label : new Date(String(label));
  return isNaN(d.getTime())
    ? String(label)
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const AnalyticsPage = () => {
  const { handleError } = use(Context);
  const theme = useMantineTheme();
  const isMobile =
    useMediaQuery(`(max-width: ${theme.breakpoints.sm})`) ?? false;
  const [kind, setKind] = useState<RunKind>(RunKind.MrReview);

  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);

  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [totalRepos, setTotalRepos] = useState(0);
  const [page, setPage] = useState(1);
  const [reposLoading, setReposLoading] = useState(true);

  // Usage and the project list are kind-independent — fetched once on mount.
  useEffect(() => {
    api.analytics.usage.get().then(({ data, error }) => {
      if (error) handleError(error.value, 'Failed to fetch usage stats');
      if (data) setUsage(data);
      setUsageLoading(false);
    });
    api.threads.projects.get().then(({ data, error }) => {
      if (error) handleError(error.value, 'Failed to fetch projects');
      if (data) setProjects(data);
    });
  }, [handleError]);

  const handleKindChange = (value: string) => {
    setKind(value as RunKind);
    setOverviewLoading(true);
    setTrendLoading(true);
  };

  useEffect(() => {
    api.analytics.overview.get({ query: { kind } }).then(({ data, error }) => {
      if (error) handleError(error.value, 'Failed to fetch overview');
      if (data) setOverview(data);
      setOverviewLoading(false);
    });
  }, [kind, handleError]);

  useEffect(() => {
    api.analytics.trend.get({ query: { kind } }).then(({ data, error }) => {
      if (error) handleError(error.value, 'Failed to fetch duration trend');
      if (data) setTrend(data);
      setTrendLoading(false);
    });
  }, [kind, handleError]);

  const handleProjectChange = (project: string | null) => {
    setSelectedProject(project);
    setPage(1);
    setReposLoading(true);
  };

  // Per-repo breakdown is scoped by kind server-side — chat threads have no metadata.project, so there's nothing to fetch for that tab.
  useEffect(() => {
    if (kind === RunKind.Chat) return;
    api.analytics['by-repo']
      .get({
        query: {
          kind,
          projectId: selectedProject ?? undefined,
          limit: REPOS_PER_PAGE,
          offset: (page - 1) * REPOS_PER_PAGE,
        },
      })
      .then(({ data, error }) => {
        if (error) handleError(error.value, 'Failed to fetch repo stats');
        if (data) {
          setRepos(data.repos);
          setTotalRepos(data.total);
        }
        setReposLoading(false);
      });
  }, [kind, selectedProject, page, handleError]);

  const totalPages = Math.max(1, Math.ceil(totalRepos / REPOS_PER_PAGE));
  const isEmpty = overview !== null && overview.total === 0;
  const repoUnit = kind === RunKind.WorkItemResolve ? 'Issue' : 'MR';

  return (
    <Stack className="analytics-page" gap="md">
      <Title order={2} visibleFrom="sm">
        Analytics
      </Title>

      <ScrollArea
        className="analytics-body-scrollarea"
        type="hover"
        offsetScrollbars="present"
      >
        <Stack gap="md">
          {usageLoading ? (
            <Skeleton height={90} radius="sm" />
          ) : (
            <Card withBorder radius="md" padding="md">
              <Group gap="xl" wrap="wrap">
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {usage?.totalUsers ?? 0}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Users
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {usage?.totalReviews ?? 0}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Reviews
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {usage?.totalChats ?? 0}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Chats
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {usage?.totalProjectMemories ?? 0}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Project memories
                  </Text>
                </Stack>
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {usage?.totalPersonalMemories ?? 0}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Personal memories
                  </Text>
                </Stack>
              </Group>
            </Card>
          )}

          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              From the last 30 days
            </Text>
            <SegmentedControl
              data={KIND_OPTIONS}
              value={kind}
              onChange={handleKindChange}
            />
          </Group>

          {overviewLoading ? (
            <Skeleton height={280} radius="sm" />
          ) : isEmpty ? (
            <Center className="analytics-empty">
              <EmptyState
                icon={<Icon as={IconChartBar} size={40} />}
                title="No runs yet"
                description={
                  kind === RunKind.MrReview
                    ? 'Once langgraph-harness reviews some merge requests, their stats will show up here.'
                    : kind === RunKind.WorkItemResolve
                      ? 'Once langgraph-harness resolves some issues, their stats will show up here.'
                      : 'Once people start chatting with langgraph-harness, their stats will show up here.'
                }
                size="md"
              />
            </Center>
          ) : (
            overview && (
              <Stack gap="md">
                <SimpleGrid cols={{ base: 1, md: 2 }}>
                  <Card withBorder radius="md" padding="md">
                    <Text fw={600} mb="sm">
                      Wait time
                    </Text>
                    {trendLoading ? (
                      <Skeleton height={200} radius="sm" />
                    ) : trend.length < 2 ? (
                      <Text size="sm" c="dimmed">
                        Not enough data yet to show a trend.
                      </Text>
                    ) : (
                      <LineChart
                        h={200}
                        data={trend}
                        dataKey="date"
                        series={[
                          {
                            name: 'avgQueueWaitMs',
                            label: 'Avg queue wait',
                            color: 'blue.6',
                          },
                          {
                            name: 'avgLlmBackendWaitMs',
                            label: 'Avg backend wait',
                            color: 'teal.6',
                          },
                        ]}
                        curveType="monotone"
                        withDots={false}
                        valueFormatter={formatDuration}
                        xAxisProps={{ tickFormatter: formatChartDate }}
                        tooltipProps={{ labelFormatter: formatChartDate }}
                      />
                    )}
                  </Card>
                  <Card withBorder radius="md" padding="md">
                    <Text fw={600} mb="sm">
                      Avg duration
                    </Text>
                    {trendLoading ? (
                      <Skeleton height={200} radius="sm" />
                    ) : trend.length < 2 ? (
                      <Text size="sm" c="dimmed">
                        Not enough data yet to show a trend.
                      </Text>
                    ) : (
                      <LineChart
                        h={200}
                        data={trend}
                        dataKey="date"
                        series={[
                          {
                            name: 'avgDurationMs',
                            label: 'Avg duration',
                            color: 'teal.6',
                          },
                        ]}
                        curveType="monotone"
                        withDots={false}
                        withLegend={false}
                        valueFormatter={formatDuration}
                        xAxisProps={{ tickFormatter: formatChartDate }}
                        tooltipProps={{ labelFormatter: formatChartDate }}
                      />
                    )}
                  </Card>

                  <Card withBorder radius="md" padding="md">
                    <Text fw={600} mb="sm">
                      Run volume
                    </Text>
                    {trendLoading ? (
                      <Skeleton height={200} radius="sm" />
                    ) : trend.length < 2 ? (
                      <Text size="sm" c="dimmed">
                        Not enough data yet to show a trend.
                      </Text>
                    ) : (
                      <LineChart
                        h={200}
                        data={trend}
                        dataKey="date"
                        series={[
                          { name: 'total', label: 'Runs', color: 'teal.6' },
                        ]}
                        curveType="monotone"
                        withDots={false}
                        withLegend={false}
                        valueFormatter={(n) => `${n} runs`}
                        xAxisProps={{ tickFormatter: formatChartDate }}
                        tooltipProps={{ labelFormatter: formatChartDate }}
                      />
                    )}
                  </Card>

                  <Card withBorder radius="md" padding="md">
                    <Text fw={600} mb="sm">
                      Success rate
                    </Text>
                    {trendLoading ? (
                      <Skeleton height={200} radius="sm" />
                    ) : trend.length < 2 ? (
                      <Text size="sm" c="dimmed">
                        Not enough data yet to show a trend.
                      </Text>
                    ) : (
                      <LineChart
                        h={200}
                        data={trend}
                        dataKey="date"
                        series={[
                          {
                            name: 'successRate',
                            label: 'Success rate',
                            color: 'teal.6',
                          },
                        ]}
                        curveType="monotone"
                        withDots={false}
                        withLegend={false}
                        valueFormatter={(n) => `${Math.round(n * 100)}%`}
                        xAxisProps={{ tickFormatter: formatChartDate }}
                        tooltipProps={{ labelFormatter: formatChartDate }}
                        yAxisProps={{
                          domain: [0, 1],
                          tickFormatter: (n: number) =>
                            `${Math.round(n * 100)}%`,
                        }}
                      />
                    )}
                  </Card>

                  <Card withBorder radius="md" padding="md">
                    <Text fw={600} mb="sm">
                      Error kinds
                    </Text>
                    {trendLoading ? (
                      <Skeleton height={200} radius="sm" />
                    ) : trend.length < 2 ? (
                      <Text size="sm" c="dimmed">
                        Not enough data yet to show a trend.
                      </Text>
                    ) : (
                      <LineChart
                        h={200}
                        data={trend}
                        dataKey="date"
                        series={[
                          {
                            name: 'timeout',
                            label: 'Timed out',
                            color: 'orange.6',
                          },
                          {
                            name: 'generationLoop',
                            label: 'Generation loop',
                            color: 'yellow.6',
                          },
                          ...(kind !== RunKind.Chat
                            ? [
                                {
                                  name: 'guardAbort',
                                  label: 'Guard-aborted',
                                  color: 'blue.6',
                                },
                              ]
                            : []),
                          {
                            name: 'manualAbort',
                            label: 'Manually aborted',
                            color: 'gray.6',
                          },
                          {
                            name: 'modelError',
                            label: 'Model error',
                            color: 'red.6',
                          },
                          {
                            name: 'serverRestart',
                            label: 'Server restart',
                            color: 'teal.6',
                          },
                        ]}
                        curveType="monotone"
                        withDots={false}
                        valueFormatter={(n) => `${n}`}
                        xAxisProps={{ tickFormatter: formatChartDate }}
                        tooltipProps={{ labelFormatter: formatChartDate }}
                      />
                    )}
                  </Card>
                </SimpleGrid>

                <Divider my="md" />

                <SimpleGrid cols={{ base: 1, md: 2 }}>
                  <Card withBorder radius="md" padding="md" h="100%">
                    <Text fw={600} mb="sm">
                      Reliability
                    </Text>
                    <Stack gap="xs">
                      <Stat
                        label="Success rate"
                        value={`${Math.round((overview.successful / overview.total) * 100)}%`}
                        c={
                          overview.successful / overview.total >= 0.7
                            ? 'green'
                            : undefined
                        }
                      />
                      <Stat label="Total runs" value={overview.total} />
                      <Stat
                        label="Runs per thread"
                        value={dash(overview.avgRunsPerThread, (n) =>
                          n.toFixed(1),
                        )}
                      />
                      <Stat
                        label="Avg / median / p95 duration"
                        tooltip="Wall-clock time from run start to finish (queue wait isn't counted). A high p95 relative to the median means a small share of runs ran far longer than typical — usually ones that failed only after getting stuck for a while (a hung call, repeated retries, or a run silently orphaned until a server restart swept it up), not the model itself taking that long."
                        value={`${dash(overview.avgDurationMs, formatDuration)} / ${dash(overview.medianDurationMs, formatDuration)} / ${dash(overview.p95DurationMs, formatDuration)}`}
                      />
                      <Divider my={4} />
                      <Stat
                        label="Timed out"
                        value={overview.errorKinds.timeout}
                        c={overview.errorKinds.timeout ? 'red' : undefined}
                      />
                      <Stat
                        label="Generation loop"
                        tooltip="Run was aborted after 1+ minute with no tool call while the model kept repeating the same text — a guardrail against a stuck generation loop."
                        value={overview.errorKinds.generationLoop}
                        c={
                          overview.errorKinds.generationLoop ? 'red' : undefined
                        }
                      />
                      {kind !== RunKind.Chat && (
                        <Stat
                          label="Guard-aborted (loop)"
                          tooltip="Run was stopped after the same tool call repeated with unchanged arguments too many times in a row — a guardrail against the model getting stuck in a loop."
                          value={overview.errorKinds.guardAbort}
                          c={overview.errorKinds.guardAbort ? 'red' : undefined}
                        />
                      )}
                      <Stat
                        label="Manually aborted"
                        value={overview.errorKinds.manualAbort}
                      />
                      <Stat
                        label="Model error"
                        value={overview.errorKinds.modelError}
                        c={overview.errorKinds.modelError ? 'red' : undefined}
                      />
                      <Stat
                        label="Server restart"
                        value={overview.errorKinds.serverRestart}
                        c={
                          overview.errorKinds.serverRestart ? 'red' : undefined
                        }
                      />
                    </Stack>
                  </Card>

                  <Card withBorder radius="md" padding="md" h="100%">
                    <Text fw={600} mb="sm">
                      Efficiency
                    </Text>
                    <Stack gap="xs">
                      <Stat
                        label="Avg LLM calls"
                        value={dash(overview.avgLlmCalls, (n) => n.toFixed(1))}
                      />
                      <Stat
                        label="Avg tool calls"
                        value={dash(overview.avgToolCalls, (n) => n.toFixed(1))}
                      />
                      <Stat
                        label="Avg unique tools"
                        value={dash(overview.avgUniqueTools, (n) =>
                          n.toFixed(1),
                        )}
                      />
                      <Stat
                        label="Avg repeated tool calls"
                        value={dash(overview.avgRepeatedToolCalls, (n) =>
                          n.toFixed(1),
                        )}
                      />
                      <Stat
                        label="Avg model retries"
                        value={dash(overview.avgModelRetries, (n) =>
                          n.toFixed(1),
                        )}
                      />
                      <Stat
                        label="Avg checkpoints"
                        tooltip="Number of resumable state snapshots the agent saved during the run — each one is a point a retry could branch from instead of starting over."
                        value={dash(overview.avgCheckpoints, (n) =>
                          n.toFixed(1),
                        )}
                      />
                      <Stat
                        label="Avg tokens per run"
                        value={dash(overview.avgTotalTokens, (n) =>
                          Math.round(n).toLocaleString(),
                        )}
                      />
                      <Stat
                        label="Avg peak context size"
                        tooltip="The largest single prompt (in tokens) sent to the model during the run — its highest point of accumulated conversation history, not a running total."
                        value={dash(overview.avgMaxContextSize, (n) =>
                          Math.round(n).toLocaleString(),
                        )}
                      />
                      <Stat
                        label="Runs using sub-agents"
                        tooltip="Runs that delegated at least one file/task to a sub-agent (e.g. a Verifier) instead of handling everything in the main agent loop."
                        value={`${overview.subagentRuns} / ${overview.total}`}
                      />
                    </Stack>
                  </Card>

                  {kind !== RunKind.Chat && (
                    <Card withBorder radius="md" padding="md" h="100%">
                      <Text fw={600} mb="sm">
                        {kind === RunKind.WorkItemResolve
                          ? 'Reply critic'
                          : 'Comment critic'}
                      </Text>
                      <Stack gap="xs">
                        <Stat
                          label="Comments screened"
                          value={overview.commentCritic.verdicts}
                        />
                        <Stat
                          label="Dropped (low value)"
                          value={overview.commentCritic.dropped}
                        />
                        <Stat
                          label="Screening failures"
                          value={overview.commentCritic.runsWithError}
                          c={
                            overview.commentCritic.runsWithError
                              ? 'red'
                              : undefined
                          }
                        />
                      </Stack>
                    </Card>
                  )}

                  {kind !== RunKind.Chat && (
                    <Card withBorder radius="md" padding="md" h="100%">
                      <Text fw={600} mb="sm">
                        Memory curator
                      </Text>
                      <Stack gap="xs">
                        <Stat
                          label="Added / updated / retired"
                          value={`${overview.memoryCurator.added} / ${overview.memoryCurator.updated} / ${overview.memoryCurator.retired}`}
                        />
                        <Stat
                          label="Missed candidates"
                          tooltip="Memory candidates the curator identified during the run but never reached a decision on — usually a truncated or failed response, not a deliberate skip."
                          value={overview.memoryCurator.missed}
                        />
                        <Stat
                          label="Curation failures"
                          value={overview.memoryCurator.runsWithError}
                          c={
                            overview.memoryCurator.runsWithError
                              ? 'red'
                              : undefined
                          }
                        />
                      </Stack>
                    </Card>
                  )}

                  {kind === RunKind.MrReview && (
                    <Card withBorder radius="md" padding="md" h="100%">
                      <Text fw={600} mb="sm">
                        Comment acceptance
                      </Text>
                      <Stack gap="xs">
                        <Stat
                          label="Acceptance rate"
                          tooltip="Share of langgraph-harness's own resolvable review comments later marked resolved. Only counts comments a follow-up review happened to re-check — an MR reviewed just once never shows up here even if a human resolved every comment, so this understates the true rate."
                          value={dash(
                            overview.ownComments.acceptanceRate,
                            (n) => `${Math.round(n * 100)}%`,
                          )}
                          c={
                            overview.ownComments.acceptanceRate !== null &&
                            overview.ownComments.acceptanceRate !== undefined &&
                            overview.ownComments.acceptanceRate >= 0.7
                              ? 'green'
                              : undefined
                          }
                        />
                        <Stat
                          label="Resolved / observed"
                          value={`${overview.ownComments.resolved} / ${overview.ownComments.total}`}
                        />
                      </Stack>
                    </Card>
                  )}
                </SimpleGrid>

                <Card withBorder radius="md" padding="md">
                  <Text fw={600}>Guardrail health</Text>
                  <Text size="xs" c="dimmed" mb="sm">
                    Applied/Failed is whether the correction itself worked, not
                    whether the model then complied — a hard abort (loop guard)
                    is a separate, direct failure shown as "Guard-aborted" under
                    Reliability.
                  </Text>
                  <Table withRowBorders={false}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Middleware</Table.Th>
                        <Table.Th>Fired</Table.Th>
                        <Table.Th>Applied</Table.Th>
                        <Table.Th>Failed</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {NUDGE_MIDDLEWARES[kind].map(({ key, label }) => {
                        const stats = overview.nudgeStats[key] ?? {
                          fired: 0,
                          resolved: 0,
                          escalated: 0,
                        };
                        return (
                          <Table.Tr key={key}>
                            <Table.Td>{label}</Table.Td>
                            <Table.Td>{stats.fired}</Table.Td>
                            <Table.Td>{stats.resolved}</Table.Td>
                            <Table.Td c={stats.escalated ? 'red' : undefined}>
                              {stats.escalated}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Card>
              </Stack>
            )
          )}
          <Divider my="md" />
          {kind !== RunKind.Chat && (
            <>
              <Group gap="sm" wrap="wrap" align="center">
                <Text fw={600}>By repository</Text>
                {projects.length > 0 && (
                  <Select
                    className="analytics-repo-filter"
                    placeholder="All repositories"
                    data={projects}
                    value={selectedProject}
                    onChange={handleProjectChange}
                    searchable
                    clearable
                    size="sm"
                  />
                )}
              </Group>

              {reposLoading ? (
                <Stack gap="xs">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} height={44} radius="sm" />
                  ))}
                </Stack>
              ) : !repos.length ? (
                <Center className="analytics-empty">
                  <EmptyState
                    icon={<Icon as={IconChartBar} size={40} />}
                    title="No data for this repository"
                    description="This repository has no completed or failed runs yet."
                    size="md"
                  />
                </Center>
              ) : isMobile ? (
                <Stack gap="xs">
                  {repos.map((row) => (
                    <Card key={row.repo} withBorder radius="md" padding="sm">
                      <Text size="sm" truncate>
                        {row.repo}
                      </Text>
                      <Group gap="xs" mt={4}>
                        <Text size="xs" c="dimmed">
                          {row.totalThreads} {repoUnit}
                          {row.totalThreads === 1 ? '' : 's'}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {row.totalRuns} runs
                        </Text>
                        <Text size="xs" c="dimmed">
                          {row.avgRunsPerThread}/{repoUnit}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {dash(row.avgDurationMs, formatDuration)} avg
                        </Text>
                      </Group>
                      <Text
                        size="xs"
                        c={row.failedRuns > 0 ? 'red' : 'dimmed'}
                        mt={4}
                      >
                        {row.failedRuns} failed
                      </Text>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Card withBorder radius="md" padding="md">
                  <Table.ScrollContainer minWidth={650}>
                    <Table
                      highlightOnHover
                      layout="fixed"
                      withRowBorders={false}
                    >
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Repo</Table.Th>
                          <Table.Th w={110}>{repoUnit}s</Table.Th>
                          <Table.Th w={110}>Runs</Table.Th>
                          <Table.Th w={110}>Runs/{repoUnit}</Table.Th>
                          <Table.Th w={130}>Avg duration</Table.Th>
                          <Table.Th w={100}>Failed</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {repos.map((row) => (
                          <Table.Tr key={row.repo}>
                            <Table.Td>
                              <Text size="sm" truncate>
                                {row.repo}
                              </Text>
                            </Table.Td>
                            <Table.Td>{row.totalThreads}</Table.Td>
                            <Table.Td>{row.totalRuns}</Table.Td>
                            <Table.Td>{row.avgRunsPerThread}</Table.Td>
                            <Table.Td>
                              {dash(row.avgDurationMs, formatDuration)}
                            </Table.Td>
                            <Table.Td>
                              <Text
                                size="sm"
                                c={row.failedRuns > 0 ? 'red' : 'dimmed'}
                              >
                                {row.failedRuns}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Card>
              )}

              {totalPages > 1 && (
                <Group justify="center" mt="sm">
                  <Button
                    variant="transparent"
                    size="compact-xs"
                    disabled={page === 1}
                    onClick={() => {
                      setPage(page - 1);
                      setReposLoading(true);
                    }}
                  >
                    Previous
                  </Button>
                  <Text size="sm" c="dimmed">
                    Page {page} of {totalPages}
                  </Text>
                  <Button
                    variant="transparent"
                    size="compact-xs"
                    disabled={page >= totalPages}
                    onClick={() => {
                      setPage(page + 1);
                      setReposLoading(true);
                    }}
                  >
                    Next
                  </Button>
                </Group>
              )}
            </>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
};

export default AnalyticsPage;
