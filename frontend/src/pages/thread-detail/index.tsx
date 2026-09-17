import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Divider,
  Drawer,
  EmptyState,
  Flex,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Title,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconGauge,
  IconHelpCircle,
  IconLayoutSidebarRightExpand,
  IconPlayerPlay,
  IconPlayerStop,
} from '@tabler/icons-react';

import type { ContextUsageBreakdown, RunEvent, Thread, Todo } from '@/types';
import { Role } from '@/types';

import Icon from '@/components/icon';
import RunList from '@/components/run/run-list';
import RunSummary from '@/components/run/run-summary';
import RunTimeline from '@/components/run/run-timeline';
import StatSummary from '@/components/stat-summary';
import TourReplayButton from '@/components/tour-replay-button';
import TodoList from './components/todo-list';

import { api, ws } from '@/api';
import { config } from '@/config';
import { Context } from '@/contexts';
import { useAuth } from '@/hooks/useAuth';
import { useConfirmAction } from '@/hooks/useConfirmAction';
import { useRunStream } from '@/hooks/useRunStream';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { THREAD_DETAIL_TOUR_ID, threadDetailSteps } from '@/tours/steps';
import { hasSeenTour, useTour } from '@/tours/tourState';
import {
  formatTokenCount,
  getContextMeter,
  isMrReviewRunInput,
  isTaskResolveRunInput,
  isWorkItemResolveRunInput,
  safeJsonParse,
} from '@/utils';

const CONTEXT_BREAKDOWN_LABELS: Record<keyof ContextUsageBreakdown, string> = {
  systemPrompt: 'System prompt',
  repoInstructions: 'Repo instructions',
  projectMemories: 'Project memories',
  toolSchemas: 'Tool schemas',
  skillContent: 'Skill content',
  messages: 'Messages',
  autocompactBuffer: 'Autocompact buffer',
  freeSpace: 'Free space',
};

const CONTEXT_BREAKDOWN_ORDER: (keyof ContextUsageBreakdown)[] = [
  'systemPrompt',
  'toolSchemas',
  'projectMemories',
  'repoInstructions',
  'skillContent',
  'messages',
  'freeSpace',
  'autocompactBuffer',
];

const ThreadDetailPage = () => {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useMantineTheme();
  const isTablet =
    useMediaQuery(`(max-width: ${theme.breakpoints.md})`) ?? false;
  const { handleError } = use(Context);
  const { startTour, registerPageDrawer } = useTour();
  const [thread, setThread] = useState<Omit<
    Thread,
    // missing from API
    'run_count' | 'failure_count'
  > | null>(null);
  const [loadedThreadId, setLoadedThreadId] = useState(threadId);
  const {
    runs,
    setRuns,
    collapsed,
    resetCollapsed,
    doStreamRun,
    handleCollapse,
    streamingForRef,
  } = useRunStream();
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [activeSubagent, setActiveSubagent] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [
    runsDrawerOpened,
    { open: openRunsDrawer, close: closeRunsDrawer, toggle: toggleRunsDrawer },
  ] = useDisclosure(false);
  const [contextBreakdownOpened, { toggle: toggleContextBreakdown }] =
    useDisclosure(false);
  const [contextWindowByModel, setContextWindowByModel] = useState<
    Record<string, number>
  >({});
  const abortRef = useRef<AbortController | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === Role.Admin;
  const retryRun = useConfirmAction({
    title: 'Retry run',
    message: 'Retry this run from this checkpoint?',
    confirmLabel: 'Retry',
  });
  const abortRun = useConfirmAction({
    title: 'Abort run',
    message: "Abort this run? This can't be undone.",
    confirmLabel: 'Abort',
    destructive: true,
  });

  // Drops stale content during render, before paint, so a new threadId never flashes the old thread.
  if (threadId !== loadedThreadId) {
    setLoadedThreadId(threadId);
    setThread(null);
    setRuns([]);
    setLoadingRuns(true);
  }

  const selectedRunId = searchParams.get('run');
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  // Thread-wide, not just selectedRun — a run can be active on a different, non-selected branch than the one in view.
  const anyRunActive = runs.some(
    (r) => r.status === 'running' || r.status === 'queued',
  );

  const debugViewportRef = useRef<HTMLDivElement>(null);
  const debugStickToBottom = useStickToBottom(
    debugViewportRef,
    selectedRun,
    anyRunActive,
  );

  const setRun = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('run', id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Only sets a default when the selection doesn't resolve to a real run — never overrides a deliberately-opened one.
  useEffect(() => {
    if (!runs.length || runs.some((r) => r.id === selectedRunId)) return;
    setRun(runs[runs.length - 1].id);
  }, [runs, selectedRunId, setRun]);

  useEffect(() => {
    (async () => {
      const { data, error } = await api.models.get();

      if (error) {
        handleError(error.value, 'Failed to fetch models');
        return;
      }

      setContextWindowByModel(
        Object.fromEntries(data.map((m) => [m.model, m.contextWindow])),
      );
    })();
  }, [handleError]);

  useEffect(() => {
    if (loadingRuns || !selectedRun || hasSeenTour(THREAD_DETAIL_TOUR_ID))
      return;
    startTour(THREAD_DETAIL_TOUR_ID, threadDetailSteps);
  }, [loadingRuns, selectedRun, startTour]);

  // Lets the tour open/close this page's runs drawer for steps whose target only exists inside it.
  useEffect(() => {
    registerPageDrawer({ open: openRunsDrawer, close: closeRunsDrawer });
    return () => registerPageDrawer(null);
  }, [registerPageDrawer, openRunsDrawer, closeRunsDrawer]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!threadId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    streamingForRef.current = null;

    (async () => {
      const [threadRes, runsRes] = await Promise.all([
        api
          .threads({ id: threadId })
          .get({ fetch: { signal: controller.signal } }),
        api
          .threads({ id: threadId })
          .runs.get({ fetch: { signal: controller.signal } }),
      ]).catch(() => [null, null]);

      if (controller.signal.aborted) return;

      if (!threadRes || threadRes.error || !runsRes || runsRes.error) {
        handleError(
          threadRes?.error?.value ?? runsRes?.error?.value,
          'Failed to load thread',
        );
        setLoadingRuns(false);
        navigate('/threads');
        return;
      }

      setThread(threadRes.data);

      const data = runsRes.data;
      setRuns(data);
      resetCollapsed(data);
      setActiveSubagent(null);

      const running = data.filter((r) => r.status === 'running');
      if (running.length) {
        for (const run of running) {
          if (controller.signal.aborted) break;
          await doStreamRun(threadId, run, controller);
        }
        if (!controller.signal.aborted) {
          try {
            const { data: latest, error } = await api
              .threads({ id: threadId })
              .runs.get({ fetch: { signal: controller.signal } });
            if (!controller.signal.aborted) {
              if (error) handleError(error.value, 'Failed to refresh runs');
              else {
                setRuns(latest);
                resetCollapsed(latest);
                setActiveSubagent(null);
              }
            }
          } catch (e) {
            if ((e as Error)?.name !== 'AbortError')
              handleError(e, 'Failed to refresh runs');
          }
        }
      }

      setLoadingRuns(false);
    })();
  }, [
    threadId,
    doStreamRun,
    handleError,
    navigate,
    resetCollapsed,
    setRuns,
    streamingForRef,
  ]);

  // Reacts to every status, not just "running" — a run can queue, run, and fail before it's ever observed as running (e.g. an immediate backend connection failure).
  useEffect(() => {
    if (!threadId) return;
    const socket = ws.subscribe();
    socket.on('error', (e) => console.error('[ws] error', e));
    socket.subscribe(({ data }) => {
      if (data.type !== 'thread:upserted') return;
      const t = data.payload;
      if (t.id !== threadId) return;

      const controller = abortRef.current!;
      (async () => {
        let runsResult;
        try {
          runsResult = await api
            .threads({ id: threadId })
            .runs.get({ fetch: { signal: controller.signal } });
        } catch (e) {
          if ((e as Error)?.name !== 'AbortError')
            handleError(e, 'Failed to refresh runs');
          return;
        }

        if (controller.signal.aborted) return;
        if (runsResult.error) {
          handleError(runsResult.error.value, 'Failed to refresh runs');
          return;
        }

        const allRuns = runsResult.data;

        setRuns((prev) => {
          const patched = prev.map((p) => {
            const match = allRuns.find((r) => r.id === p.id);
            if (!match) return p;
            // Keep a streaming run's local event log; only sync status/timing so a fast terminal state isn't lost.
            if (streamingForRef.current === p.id) {
              return {
                ...p,
                status: match.status,
                started_at: match.started_at,
              };
            }
            return match;
          });
          const fresh = allRuns.filter((r) => !prev.some((p) => p.id === r.id));
          return fresh.length ? [...patched, ...fresh] : patched;
        });

        const running = allRuns.filter((r) => r.status === 'running');

        for (const run of running) {
          if (controller.signal.aborted) break;
          if (streamingForRef.current === run.id) continue;
          await doStreamRun(threadId, run, controller);
        }
      })();
    });
    return () => {
      socket.close();
    };
  }, [threadId, doStreamRun, handleError, setRuns, streamingForRef]);

  const requestRetry = (runId: string, checkpointId?: string) => {
    if (!threadId || anyRunActive || !isAdmin) return;
    retryRun.request(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoadingRuns(true);

      const { data: newRun, error } = await api
        .threads({ id: threadId })
        .runs({ runId })
        .retry.post(checkpointId ? { checkpointId } : {}, {
          fetch: { signal: controller.signal },
        });

      if (error || controller.signal.aborted) {
        setLoadingRuns(false);
        return;
      }

      setRuns((prev) => [...prev, newRun]);
      setRun(newRun.id);
      debugStickToBottom.scrollToBottom();

      void (async () => {
        await doStreamRun(threadId, newRun, controller);

        if (!controller.signal.aborted) {
          try {
            const { data: latest, error: refreshError } = await api
              .threads({ id: threadId })
              .runs.get({ fetch: { signal: controller.signal } });
            if (!controller.signal.aborted) {
              if (refreshError)
                handleError(refreshError.value, 'Failed to refresh runs');
              else {
                setRuns(latest);
                resetCollapsed(latest);
                setActiveSubagent(null);
              }
            }
          } catch (e) {
            if ((e as Error)?.name !== 'AbortError')
              handleError(e, 'Failed to refresh runs');
          }
          setLoadingRuns(false);
        }
      })();
    });
  };

  const requestAbort = () => {
    if (!threadId || !selectedRunId || !isAdmin) return;
    abortRun.request(async () => {
      const { error } = await api
        .threads({ id: threadId })
        .runs({ runId: selectedRunId })
        .abort.post();

      if (error) {
        handleError(error.value, 'Failed to abort run');
        return;
      }
    });
  };

  const selectedRunEvents = selectedRun?.events ?? [];
  let latestTodosEvent: Extract<RunEvent, { event: 'tool_input' }> | undefined;
  for (let i = selectedRunEvents.length - 1; i >= 0; i--) {
    const e = selectedRunEvents[i];
    if (e.event === 'tool_input' && e.data.name === 'write_todos') {
      latestTodosEvent = e;
      break;
    }
  }
  const latestTodos = latestTodosEvent
    ? (latestTodosEvent.data.input.todos as Todo[])
    : null;
  const threadMetrics = useMemo(() => {
    const toolOutputs = new Map<string, boolean>();

    for (const run of runs) {
      for (const { event, data } of run.events) {
        if (event === 'tool_output') {
          const parsedOutput = data.output
            ? (safeJsonParse(data.output) as { error?: unknown } | undefined)
            : undefined;
          const didToolCallSucceed = data.output ? !parsedOutput?.error : true;

          if (didToolCallSucceed) {
            toolOutputs.set(data.id, true);
          }
        }
      }
    }

    let created = 0;
    let deleted = 0;
    let resolved = 0;

    for (const run of runs) {
      for (const e of run.events) {
        if (e.event !== 'tool_input') continue;

        const { id, name, input } = e.data;

        if (
          [
            'gitlab__create_draft_note',
            'gitlab__create_merge_request_thread',
          ].includes(name) &&
          toolOutputs.has(id)
        ) {
          created++;
        } else if (
          name === 'gitlab__delete_draft_note' &&
          toolOutputs.has(id)
        ) {
          deleted++;
        } else if (
          name === 'gitlab__resolve_merge_request_thread' &&
          input.resolved !== false
        ) {
          resolved++;
        }
      }
    }

    const opened = Math.max(0, created - deleted);
    return { opened, resolved, open: Math.max(0, opened - resolved) };
  }, [runs]);

  // Curation only settles at the run's end — until then, count raw create_memory_candidate calls as "pending" instead of showing nothing.
  let extractMemoryEndEvent:
    Extract<RunEvent, { event: 'extract_project_memory_end' }> | undefined;
  for (let i = selectedRunEvents.length - 1; i >= 0; i--) {
    const e = selectedRunEvents[i];
    if (e.event === 'extract_project_memory_end') {
      extractMemoryEndEvent = e;
      break;
    }
  }
  const runMemories = extractMemoryEndEvent
    ? extractMemoryEndEvent.data.decisions.reduce(
        (counts, d) => {
          counts[d.action]++;
          return counts;
        },
        { add: 0, update: 0, retire: 0, skip: 0 },
      )
    : {
        pending: selectedRunEvents.filter(
          (e) =>
            e.event === 'tool_input' &&
            e.data.name === 'create_memory_candidate',
        ).length,
      };
  // A run's delta baseline is the previous run's end, or a fork's branch checkpoint (which can be earlier than the parent's final total).
  // `checkpointTotal` snapshots the running total per checkpoint so forks can find their exact branch point.
  const { precedingContextTotalByRunId, latestContextUsage } = useMemo(() => {
    const map: Record<string, number> = {};
    const checkpointTotal = new Map<string, number>();
    let carry = 0;
    let latest: {
      totalTokens: number;
      contextWindow: number;
      breakdown?: ContextUsageBreakdown;
    } | null = null;

    for (const run of runs) {
      const baseline =
        (run.parent_checkpoint_id
          ? checkpointTotal.get(run.parent_checkpoint_id)
          : undefined) ?? carry;
      map[run.id] = baseline;

      let runningTotal = baseline;
      let runningBreakdown: ContextUsageBreakdown | undefined;
      let hadUsage = false;

      for (const e of run.events) {
        if (e.event === 'context_usage') {
          runningTotal = e.data.totalTokens;
          runningBreakdown = e.data.breakdown;
          hadUsage = true;
        } else if (
          e.event === 'checkpoint' &&
          !checkpointTotal.has(e.data.id)
        ) {
          checkpointTotal.set(e.data.id, runningTotal);
        }
      }

      if (hadUsage) {
        carry = runningTotal;
        const contextWindow = contextWindowByModel[run.input.model];
        if (contextWindow)
          latest = {
            totalTokens: runningTotal,
            contextWindow,
            breakdown: runningBreakdown,
          };
      }
    }

    return { precedingContextTotalByRunId: map, latestContextUsage: latest };
  }, [runs, contextWindowByModel]);

  const {
    percent: contextPercent,
    color: contextColor,
    tooltipLabel: contextTooltipLabel,
  } = getContextMeter(latestContextUsage, 'thread');
  const firstInput = runs[0]?.input;
  const externalLink =
    firstInput && isMrReviewRunInput(firstInput)
      ? {
          url: `${config.gitlabUrl}/${firstInput.query.projectId}/-/merge_requests/${firstInput.query.mrIid}`,
          label: 'Open merge request',
        }
      : firstInput && isWorkItemResolveRunInput(firstInput)
        ? {
            url: `${config.gitlabUrl}/${firstInput.projectPath}/-/work_items/${firstInput.issueIid}`,
            label: 'Open work item',
          }
        : // No issue behind a task — the MR it opened is the only thing to link to, and only once it exists.
          firstInput &&
            isTaskResolveRunInput(firstInput) &&
            thread?.metadata?.mrIid
          ? {
              url: `${config.gitlabUrl}/${firstInput.projectPath}/-/merge_requests/${thread.metadata.mrIid}`,
              label: 'Open merge request',
            }
          : undefined;
  const header = (
    <Group
      className="thread-detail__header"
      justify="space-between"
      wrap="nowrap"
      gap="xs"
    >
      <Group gap="xs" wrap="nowrap" className="thread-detail__header-title">
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => navigate('/threads')}
          aria-label="Back to sessions"
        >
          <Icon as={IconArrowLeft} />
        </ActionIcon>
        {thread ? (
          <>
            <Title order={4} className="thread-detail__title">
              {thread.title}
            </Title>
            <TourReplayButton
              tourId={THREAD_DETAIL_TOUR_ID}
              steps={threadDetailSteps}
            />
          </>
        ) : (
          <Skeleton height={20} width={180} radius="sm" />
        )}
        {externalLink && (
          <Tooltip label={externalLink.label}>
            <ActionIcon
              component="a"
              href={externalLink.url}
              target="_blank"
              rel="noreferrer"
              variant="subtle"
              color="gray"
              aria-label={externalLink.label}
            >
              <Icon as={IconExternalLink} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {selectedRun?.status === 'running' && isAdmin && (
        <>
          <Button
            color="red"
            variant="filled"
            size="xs"
            onClick={requestAbort}
            leftSection={<Icon as={IconPlayerStop} />}
            visibleFrom="md"
          >
            Abort
          </Button>
          <ActionIcon
            color="red"
            variant="filled"
            onClick={requestAbort}
            hiddenFrom="md"
          >
            <Icon as={IconPlayerStop} />
          </ActionIcon>
        </>
      )}
    </Group>
  );
  const runsLoading = loadingRuns && !runs.length;
  const runsLabel = (
    <Group gap={4} py="xs" data-tour="thread-runs">
      <Text size="sm">Runs</Text>
      {runs.length > 1 && (
        <Tooltip
          label="Each run continues with the context from previous runs in this thread"
          multiline
          w={220}
        >
          <Icon as={IconHelpCircle} />
        </Tooltip>
      )}
    </Group>
  );
  const runsListBody = (
    <Stack gap="xs" h="100%">
      {runsLoading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={52} radius="sm" />
        ))
      ) : runs.length ? (
        <RunList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={(id) => {
            setRun(id);
            if (isTablet) closeRunsDrawer();
          }}
          contextWindowByModel={contextWindowByModel}
          precedingContextTotalByRunId={precedingContextTotalByRunId}
        />
      ) : (
        <Text size="sm" c="dimmed">
          No runs yet
        </Text>
      )}
    </Stack>
  );
  const runsElement = (
    <>
      {runsLabel}
      <ScrollArea flex={1} h={0} type="hover" offsetScrollbars="y">
        {runsListBody}
      </ScrollArea>
    </>
  );
  const threadMetricsElement = (
    <StatSummary
      title="Review threads"
      tooltip="Review threads langgraph-harness opened/resolved across all runs"
      dataTour="thread-metrics"
      stats={
        threadMetrics.opened > 0
          ? [
              { color: 'gray', label: 'opened', value: threadMetrics.opened },
              {
                color: 'green',
                label: 'resolved',
                value: threadMetrics.resolved,
                tooltip:
                  'Includes threads opened by human reviewers that langgraph-harness resolved, not just threads it opened itself',
              },
              { color: 'orange', label: 'open', value: threadMetrics.open },
            ]
          : []
      }
    />
  );
  const memoryStats =
    'pending' in runMemories
      ? runMemories.pending > 0
        ? [{ color: 'gray', label: 'pending', value: runMemories.pending }]
        : []
      : (
          [
            { color: 'green', label: 'new', value: runMemories.add },
            { color: 'blue', label: 'updated', value: runMemories.update },
            { color: 'red', label: 'retired', value: runMemories.retire },
            { color: 'gray', label: 'skipped', value: runMemories.skip },
          ] as const
        ).filter((s) => s.value > 0);
  const runMemoriesElement = (
    <StatSummary
      title="Memories"
      tooltip="Durable, repo-specific facts flagged during this run — pending until the run ends, then shown as new, updated, retired, or skipped"
      dataTour="thread-memories"
      stats={memoryStats}
    />
  );
  const mainContent = runsLoading ? (
    <Stack gap="md">
      <Group gap="xs" px="md">
        <Skeleton height={32} width={80} radius="sm" />
        <Skeleton height={32} width={80} radius="sm" />
      </Group>
      <Divider />
      {Array.from({ length: 2 }).map((_, i) => {
        return (
          <Stack
            key={i}
            gap="xs"
            px="md"
            w="var(--thread-list-width)"
            maw="100%"
            mx="auto"
          >
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton
                key={j}
                height={24}
                width={j === 3 ? (i === 1 ? '60%' : '80%') : undefined}
                radius="sm"
              />
            ))}
          </Stack>
        );
      })}
    </Stack>
  ) : selectedRun ? (
    <>
      <Tabs className="thread-detail__tabs" defaultValue="summary">
        <Tabs.List px="md" pt="sm" data-tour="thread-tabs">
          <Tabs.Tab value="summary">Summary</Tabs.Tab>
          <Tabs.Tab value="debug">Debug</Tabs.Tab>
          {isTablet && (
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={toggleRunsDrawer}
              aria-label="Toggle runs sidebar"
              ml="auto"
            >
              <Icon as={IconLayoutSidebarRightExpand} />
            </ActionIcon>
          )}
        </Tabs.List>
        <Tabs.Panel className="thread-detail__tab-panel" value="summary">
          <ScrollArea type="hover" h="100%" offsetScrollbars="present">
            <RunSummary run={selectedRun} />
          </ScrollArea>
        </Tabs.Panel>
        <Tabs.Panel className="thread-detail__tab-panel" value="debug">
          {!!selectedRun && (
            <ScrollArea
              type="hover"
              h="100%"
              offsetScrollbars="present"
              viewportRef={debugViewportRef}
              onScrollPositionChange={debugStickToBottom.onScrollPositionChange}
            >
              <RunTimeline
                runs={[selectedRun]}
                collapsed={collapsed}
                loading={anyRunActive}
                onCollapse={handleCollapse}
                onRetry={
                  isAdmin && !thread?.archived_at ? requestRetry : undefined
                }
                onDecision={() => {}}
                precedingContextTotalByRunId={precedingContextTotalByRunId}
                activeSubagent={activeSubagent}
                onOpenSubagent={(id, label) => {
                  setActiveSubagent({ id, label });
                  debugViewportRef.current?.scrollTo({ top: 0 });
                }}
                onCloseSubagent={() => {
                  setActiveSubagent(null);
                  debugViewportRef.current?.scrollTo({ top: 0 });
                }}
              />
            </ScrollArea>
          )}
        </Tabs.Panel>
      </Tabs>
      {(!!latestTodos || contextPercent !== null) && (
        <Stack className="thread-detail__footer" gap={2}>
          {contextPercent !== null && latestContextUsage && (
            <Card
              className="context-meter"
              radius="md"
              w="100%"
              pb={contextBreakdownOpened ? 0 : undefined}
              data-tour="thread-context"
            >
              <Card.Section
                className="context-meter__header context-meter__header--clickable"
                p="xs"
                onClick={toggleContextBreakdown}
              >
                <Flex gap="sm" align="center" justify="space-between">
                  <Group gap={6}>
                    <Icon as={IconGauge} size={12} />
                    <Text size="xs">Context</Text>
                  </Group>
                  <Group
                    flex="1"
                    wrap="nowrap"
                    gap="xs"
                    miw={0}
                    justify="flex-end"
                  >
                    <Badge color={contextColor} size="sm">
                      {contextPercent}%
                    </Badge>
                    <Icon
                      as={
                        contextBreakdownOpened
                          ? IconChevronDown
                          : IconChevronRight
                      }
                    />
                  </Group>
                </Flex>
              </Card.Section>
              {contextBreakdownOpened && (
                <>
                  <Divider />
                  <Card.Section p="xs">
                    <Stack gap={4}>
                      <Text size="xs" c="dimmed">
                        {contextTooltipLabel}
                      </Text>
                      {latestContextUsage.breakdown &&
                        CONTEXT_BREAKDOWN_ORDER.filter(
                          (category) =>
                            latestContextUsage.breakdown![category] !==
                            undefined,
                        ).map((category) => {
                          const tokens =
                            latestContextUsage.breakdown![category];
                          return (
                            <Flex
                              key={category}
                              justify="space-between"
                              gap="sm"
                            >
                              <Text size="xs" c="dimmed">
                                {CONTEXT_BREAKDOWN_LABELS[category]}
                              </Text>
                              <Text size="xs">
                                {formatTokenCount(tokens)} (
                                {Math.round(
                                  (tokens / latestContextUsage.contextWindow) *
                                    100,
                                )}
                                %)
                              </Text>
                            </Flex>
                          );
                        })}
                    </Stack>
                  </Card.Section>
                </>
              )}
            </Card>
          )}
          {!!latestTodos && <TodoList todos={latestTodos} />}
        </Stack>
      )}
    </>
  ) : (
    <Center h="100%">
      <EmptyState
        icon={<Icon as={IconPlayerPlay} size={40} />}
        title="No runs yet"
        description="Runs will appear here once this thread starts processing"
        size="md"
      />
    </Center>
  );

  const confirmModals = (
    <>
      {retryRun.modal}
      {abortRun.modal}
    </>
  );

  if (isTablet) {
    return (
      <div className="thread-detail" data-breakpoint="tablet">
        {confirmModals}
        {header}
        <Drawer
          classNames={{
            body: 'thread-detail__drawer',
          }}
          opened={runsDrawerOpened}
          onClose={closeRunsDrawer}
          position="right"
          size={300}
          padding="xs"
          withCloseButton={false}
        >
          <Stack gap="xs" h="100%">
            {runsElement}
            {runMemoriesElement}
            {threadMetricsElement}
          </Stack>
        </Drawer>
        <ScrollArea type="hover" h="100%" offsetScrollbars="present">
          {mainContent}
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="thread-detail">
      {confirmModals}
      {header}
      <div className="thread-detail__body">
        <div className="thread-detail__tabs-pane">{mainContent}</div>
        <div className="thread-detail__runs-pane">
          {runsElement}
          {threadMetricsElement}
          {runMemoriesElement}
        </div>
      </div>
    </div>
  );
};

export default ThreadDetailPage;
