import { Fragment, type MouseEventHandler, useState } from 'react';
import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Image,
  ScrollArea,
  SimpleGrid,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconGauge,
  IconGitBranch,
  IconGitCommit,
  IconHourglass,
  IconRefresh,
  IconRobot,
  IconX,
} from '@tabler/icons-react';

import type { Run } from '@/types';

import Counter from '@/components/counter';
import Icon from '@/components/icon';
import ImageLightbox from '@/components/image-lightbox';
import LoadingBubbles from '@/components/loading-bubbles';
import { Markdown } from '@/components/markdown';

import {
  formatDate,
  formatDuration,
  formatTokenCount,
  getRunMode,
  isChatRunInput,
  resolveUploadUrl,
  safeJsonParse,
} from '@/utils';

interface IRunTimelineProps {
  runs: Run[];
  collapsed: string[];
  onCollapse: MouseEventHandler<HTMLElement>;
  onRetry?: (runId: string, checkpointId?: string) => void;
  onDecision: (
    runId: string,
    toolCallId: string,
    decision: 'approve' | 'reject',
  ) => void;
  loading: boolean;
  precedingContextTotalByRunId: Record<string, number>;
  activeSubagent?: { id: string; label: string } | null;
  onOpenSubagent?: (id: string, label: string) => void;
  onCloseSubagent?: () => void;
}

const IMAGE_THUMB_SIZE = 120;
const IMAGE_GRID_MAX_ROWS = 3;
const IMAGE_GRID_MAX_HEIGHT = `calc(${IMAGE_GRID_MAX_ROWS} * ${IMAGE_THUMB_SIZE}px + ${IMAGE_GRID_MAX_ROWS - 1} * var(--mantine-spacing-xs))`;

const RUN_STEP_LABELS: Record<string, string> = {
  prepare_worktree: 'Prepare worktree',
  set_git_identity: 'Set git identity',
  sandbox_kill: 'Kill sandbox',
  classify_issue: 'Classify issue',
  assess_completion: 'Assess completion',
  update_merge_request: 'Update merge request',
  notify_issue_end: 'Notify issue end',
  no_changes: 'No changes — branch abandoned',
};

function runStepTitle(
  event: Extract<Run['events'][number], { event: 'run_step_start' }>,
): string {
  if (event.data.step === 'sandbox_create') {
    return `Create sandbox · ${event.data.image}`;
  }
  if (event.data.step === 'create_branch') {
    return `Create branch & push · ${event.data.branchName}`;
  }
  if (event.data.step === 'push') {
    return `Push · ${event.data.sourceBranch}`;
  }
  if (event.data.step === 'mr_create') {
    return `Open MR · ${event.data.sourceBranch} → ${event.data.targetBranch}`;
  }
  if (event.data.step === 'no_changes') {
    return `No changes · ${event.data.branchName}`;
  }
  return RUN_STEP_LABELS[event.data.step] ?? event.data.step;
}

const RunTimeline = ({
  runs,
  collapsed,
  onCollapse,
  onRetry,
  onDecision,
  loading,
  precedingContextTotalByRunId,
  activeSubagent,
  onOpenSubagent,
  onCloseSubagent,
}: IRunTimelineProps) => {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // loading reflects the whole run, not the sub-agent in view — its own tool_output means it's done even if the run isn't.
  const activeSubagentDone =
    !!activeSubagent &&
    runs.some((r) =>
      r.events.some(
        (e) => e.event === 'tool_output' && e.data.id === activeSubagent.id,
      ),
    );
  const resolvedToolCallIds = new Set(
    runs
      .filter((r) => r.resume_payload)
      .map((r) => r.resume_payload!.toolCallId),
  );

  const inActiveScope = (event: Run['events'][number]): boolean => {
    const subagentId =
      'subagentId' in event.data ? event.data.subagentId : undefined;
    return activeSubagent
      ? subagentId === activeSubagent.id
      : subagentId === undefined;
  };

  return (
    <div className="run-timeline">
      {activeSubagent && (
        <div className="run-timeline__branch-header">
          <ActionIcon
            variant="transparent"
            size="sm"
            onClick={onCloseSubagent}
            aria-label="Back to review"
          >
            <Icon as={IconArrowLeft} size={16} />
          </ActionIcon>
          <Text size="xs">{activeSubagent.label}</Text>
        </div>
      )}
      {runs.map((run) => {
        const runStepEndById = new Map(
          run.events
            .filter((e) => e.event === 'run_step_end')
            .map((e) => [e.data.id, e]),
        );

        const toolOutputs = new Map(
          run.events
            .filter((e) => e.event === 'tool_output')
            .map((e) => [e.data.id, e.data.output || true]),
        );

        const toolEndTs = new Map(
          run.events
            .filter((e) => e.event === 'tool_output')
            .map((e) => [e.data.id, e.data.timestamp]),
        );

        const nodeEnded = new Set(
          run.events
            .filter((e) => e.event === 'node_end')
            .map((e) => e.data.node),
        );

        const nodeEndTs = new Map(
          run.events
            .filter((e) => e.event === 'node_end')
            .map((e) => [e.data.node, e.data.timestamp]),
        );

        const nodeEndPayloadByNode = new Map(
          run.events
            .filter((e) => e.event === 'node_end')
            .filter((e) => e.data.payload)
            .map((e) => [e.data.node, e.data.payload]),
        );

        const hasCheckpoint = run.events.some((e) => e.event === 'checkpoint');

        const contextUsageEvents = run.events.filter(
          (
            e,
          ): e is Extract<Run['events'][number], { event: 'context_usage' }> =>
            e.event === 'context_usage' && inActiveScope(e),
        );
        // A run's first call re-sends prior runs' whole conversation, so the root baseline isn't 0 — a sub-agent's conversation is always fresh, so its baseline is.
        const precedingContextTotal = activeSubagent
          ? 0
          : (precedingContextTotalByRunId[run.id] ?? 0);
        // promptTokens, not totalTokens — completion (reasoning) swings turn to turn and mostly isn't resent as history.
        const contextDeltas = new Map(
          contextUsageEvents.map((e, i) => [
            e,
            e.data.promptTokens -
              (i > 0
                ? contextUsageEvents[i - 1].data.promptTokens
                : precedingContextTotal),
          ]),
        );

        const summarizeContextEndById = new Map(
          run.events
            .filter((e) => e.event === 'summarize_context_end')
            .map((e) => [e.data.id, e]),
        );

        const llmBackendWaitEndById = new Map(
          run.events
            .filter((e) => e.event === 'llm_backend_wait_end')
            .map((e) => [e.data.id, e]),
        );

        const modelRetryById = new Map(
          run.events
            .filter((e) => e.event === 'model_retry')
            .map((e) => [e.data.id, e]),
        );

        const criticEndById = new Map(
          run.events
            .filter(
              (e) =>
                e.event === 'comment_critic_end' ||
                e.event === 'reply_critic_end',
            )
            .map((e) => [e.data.id, e]),
        );

        const correctiveNudgeEndById = new Map(
          run.events
            .filter((e) => e.event === 'corrective_nudge_end')
            .map((e) => [e.data.id, e]),
        );

        const extractProjectMemoryEndById = new Map(
          run.events
            .filter((e) => e.event === 'extract_project_memory_end')
            .map((e) => [e.data.id, e]),
        );

        // Merges chunks by message id — already merged server-side once persisted, but a live run reads straight from run.events before that happens.
        const messageIndexById = new Map<string, number>();
        const renderableEvents = run.events.reduce<Run['events']>((acc, e) => {
          if (!inActiveScope(e)) return acc;

          if (
            e.event === 'run_step_end' ||
            e.event === 'tool_output' ||
            e.event === 'node_end' ||
            e.event === 'summarize_context_end' ||
            e.event === 'llm_backend_wait_end' ||
            e.event === 'comment_critic_end' ||
            e.event === 'reply_critic_end' ||
            e.event === 'corrective_nudge_end' ||
            e.event === 'extract_project_memory_end'
          ) {
            return acc;
          }

          if (e.event === 'model_retry') {
            if (modelRetryById.get(e.data.id) !== e) return acc;
            acc.push(e);
            return acc;
          }

          if (e.event === 'message') {
            const index = messageIndexById.get(e.data.id);
            if (index !== undefined) {
              const existing = acc[index] as Extract<
                Run['events'][number],
                { event: 'message' }
              >;
              acc[index] = {
                ...existing,
                data: {
                  ...existing.data,
                  content: existing.data.content + e.data.content,
                  reasoningContent:
                    existing.data.reasoningContent + e.data.reasoningContent,
                },
              };
              return acc;
            }
            messageIndexById.set(e.data.id, acc.length);
          }

          acc.push(e);
          return acc;
        }, []);

        const startedAt = formatDate(run.started_at);
        const runDurationMs =
          run.started_at && run.completed_at
            ? +new Date(run.completed_at) - +new Date(run.started_at)
            : null;
        const runDuration =
          runDurationMs !== null ? formatDuration(runDurationMs) : null;

        return (
          <Fragment key={run.id}>
            {getRunMode(run) === 'retry' && !isChatRunInput(run.input) && (
              <div className="run-timeline__branch-header">
                <Icon as={IconGitBranch} />
                <Text size="xs">Forked from an earlier run</Text>
              </div>
            )}
            {
              // A retry or a decision-resume replays its ancestor's stored input — no new query to show.
              isChatRunInput(run.input) &&
              getRunMode(run) !== 'fresh' ? null : (
                <div className="run-timeline__item" data-event="input">
                  <div id={`run-${run.id}`} className="run-timeline__input">
                    {isChatRunInput(run.input) ? (
                      <>
                        {run.input.query.images?.length ? (
                          <ScrollArea.Autosize
                            mah={IMAGE_GRID_MAX_HEIGHT}
                            type="hover"
                            offsetScrollbars="present"
                            mb="xs"
                          >
                            <SimpleGrid cols={3} spacing="xs">
                              {run.input.query.images.map((ref, i) => (
                                <Image
                                  key={i}
                                  src={resolveUploadUrl(ref)}
                                  w={IMAGE_THUMB_SIZE}
                                  height={IMAGE_THUMB_SIZE}
                                  radius="sm"
                                  fit="cover"
                                  className="run-timeline__image"
                                  onClick={() =>
                                    setLightboxSrc(resolveUploadUrl(ref))
                                  }
                                />
                              ))}
                            </SimpleGrid>
                          </ScrollArea.Autosize>
                        ) : null}
                        <Text className="run-timeline__query">
                          {run.input.query.message}
                        </Text>
                      </>
                    ) : (
                      <pre>{JSON.stringify(run.input, null, 2)}</pre>
                    )}
                  </div>
                  {(startedAt || (isChatRunInput(run.input) && onRetry)) && (
                    <div className="run-timeline__item-meta">
                      {isChatRunInput(run.input) && onRetry && (
                        <Tooltip label="Retry">
                          <ActionIcon
                            variant="transparent"
                            size="sm"
                            onClick={() =>
                              onRetry(
                                run.id,
                                run.events.find((e) => e.event === 'checkpoint')
                                  ?.data.id,
                              )
                            }
                            disabled={loading}
                            aria-label="Retry"
                          >
                            <Icon as={IconRefresh} size={16} stroke="dimmed" />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {startedAt && (
                        <Tooltip label={startedAt.full}>
                          <Text component="span" size="xs" c="dimmed">
                            {startedAt.display}
                            {runDuration && ` · ${runDuration}`}
                          </Text>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>
              )
            }

            {renderableEvents.map((event) => {
              if (event.event === 'interrupt') {
                // Once resolved, the resumed run's own tool_input/tool_output pair.
                if (resolvedToolCallIds.has(event.data.toolCallId)) return null;

                return (
                  <div
                    key={`interrupt:${event.data.id}`}
                    className="run-timeline__interrupt"
                  >
                    <Group gap="xs" wrap="nowrap">
                      <Icon
                        as={IconAlertTriangle}
                        size={16}
                        color="var(--mantine-color-yellow-text)"
                      />
                      <Text size="sm" fw={500} c="yellow">
                        Approval needed
                      </Text>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {event.data.name}
                    </Text>
                    <pre>{JSON.stringify(event.data.args, null, 2)}</pre>
                    <Group justify="flex-end" gap="xs">
                      <Button
                        variant="default"
                        size="compact-xs"
                        leftSection={<Icon as={IconX} size={12} />}
                        disabled={loading}
                        onClick={() =>
                          onDecision(run.id, event.data.toolCallId, 'reject')
                        }
                      >
                        Reject
                      </Button>
                      <Button
                        size="compact-xs"
                        leftSection={<Icon as={IconCheck} size={12} />}
                        disabled={loading}
                        onClick={() =>
                          onDecision(run.id, event.data.toolCallId, 'approve')
                        }
                      >
                        Approve
                      </Button>
                    </Group>
                  </div>
                );
              }

              if (event.event === 'checkpoint') {
                // Skip a decision-resume's own leading checkpoint — it'd show "Retry from here" mid-approval-flow instead of on later turns.
                if (getRunMode(run) === 'resume') return null;

                // Chat's retry lives under the user message bubble instead.
                if (isChatRunInput(run.input)) return null;

                return (
                  <div
                    key={`checkpoint:${event.data.id}`}
                    className="run-timeline__checkpoint"
                    data-disabled={loading}
                  >
                    <Divider />
                    {onRetry ? (
                      <Button
                        variant="default"
                        size="compact-xs"
                        className="run-timeline__checkpoint-btn"
                        leftSection={<Icon as={IconRefresh} />}
                        onClick={() => onRetry(run.id, event.data.id)}
                        disabled={loading}
                      >
                        Retry from here
                      </Button>
                    ) : (
                      <Group gap={4}>
                        <Icon as={IconGitCommit} stroke="dimmed" />
                        <Text size="xs" c="dimmed">
                          Checkpoint
                        </Text>
                      </Group>
                    )}
                    <Divider />
                  </div>
                );
              }

              if (event.event === 'run_step_start') {
                const id = event.data.id;
                const endEvent = runStepEndById.get(id);
                const done = !!endEvent;
                const duration = done
                  ? formatDuration(
                      endEvent.data.timestamp - event.data.timestamp,
                    )
                  : null;
                const label = runStepTitle(event);
                const worktreeEnd =
                  done && endEvent.data.step === 'prepare_worktree'
                    ? endEvent.data
                    : undefined;
                const pushEnd =
                  done && endEvent.data.step === 'push'
                    ? endEvent.data
                    : undefined;

                return (
                  <div
                    key={id}
                    className="run-timeline__item"
                    data-event="run_step_start"
                  >
                    <span
                      className="run-timeline__tool"
                      data-collapsed={collapsed.includes(id)}
                      data-id={id}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(id) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span
                        className="run-timeline__tool-title"
                        data-pending={
                          (!done && run.status === 'running') || undefined
                        }
                        data-errored={
                          (done && !!endEvent.data.error) || undefined
                        }
                      >
                        {label}
                        {worktreeEnd?.cloned && ' · cloned'}
                      </span>
                      {worktreeEnd?.revived && (
                        <Text
                          component="span"
                          c="var(--mantine-color-yellow-6)"
                        >
                          (revived from sha)
                        </Text>
                      )}
                      {!!worktreeEnd?.retries && (
                        <Text
                          component="span"
                          c="var(--mantine-color-yellow-6)"
                        >
                          (retried {worktreeEnd.retries}x)
                        </Text>
                      )}
                      {pushEnd?.forced && (
                        <Text
                          component="span"
                          c="var(--mantine-color-yellow-6)"
                        >
                          (force)
                        </Text>
                      )}
                      {duration && (
                        <Tooltip
                          label={new Date(
                            event.data.timestamp,
                          ).toLocaleString()}
                        >
                          <Text component="span" size="sm" c="dimmed" ml={8}>
                            {duration}
                          </Text>
                        </Tooltip>
                      )}
                    </span>
                    {!collapsed.includes(id) && done && (
                      <div className="run-timeline__tool-content">
                        <pre>
                          {JSON.stringify(
                            (() => {
                              const merged = {
                                ...event.data,
                                ...endEvent.data,
                              };
                              // eslint-disable-next-line @typescript-eslint/no-unused-vars
                              const { id, step, timestamp, ...rest } = merged;
                              return rest;
                            })(),
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              }

              if (!isChatRunInput(run.input) && event.event === 'node_start') {
                const done = nodeEnded.has(event.data.node);
                const endTs = nodeEndTs.get(event.data.node);
                const duration =
                  done && endTs
                    ? formatDuration(endTs - event.data.timestamp)
                    : null;
                const nodePayload = nodeEndPayloadByNode.get(event.data.node);
                const id = `node:${run.id}:${event.data.node}`;
                const isCollapsed = collapsed.includes(id);

                return (
                  <div
                    key={`node:${event.data.node}`}
                    className="run-timeline__item"
                    data-event="node_start"
                  >
                    <div
                      className="run-timeline__node"
                      data-collapsible={nodePayload ? true : undefined}
                      data-collapsed={nodePayload ? isCollapsed : undefined}
                      data-id={nodePayload ? id : undefined}
                      onClick={nodePayload ? onCollapse : undefined}
                    >
                      <Icon
                        as={IconBolt}
                        data-pending={
                          (!done && run.status === 'running') || undefined
                        }
                      />
                      {nodePayload &&
                        (isCollapsed ? (
                          <Icon as={IconChevronRight} />
                        ) : (
                          <Icon as={IconChevronDown} />
                        ))}
                      <span
                        className="run-timeline__node-title"
                        data-pending={
                          (!done && run.status === 'running') || undefined
                        }
                        data-errored={nodePayload?.error ? true : undefined}
                      >
                        {event.data.node}
                      </span>
                      {duration && (
                        <Tooltip
                          label={new Date(
                            event.data.timestamp,
                          ).toLocaleString()}
                        >
                          <Text component="span" size="sm" c="dimmed" ml={8}>
                            {duration}
                          </Text>
                        </Tooltip>
                      )}
                    </div>
                    {nodePayload && !isCollapsed && (
                      <div className="run-timeline__tool-content">
                        {nodePayload.error && (
                          <Text size="sm" c="dimmed" py="sm">
                            {nodePayload.error}
                          </Text>
                        )}
                        <ScrollArea.Autosize
                          mah="40dvh"
                          type="hover"
                          offsetScrollbars="present"
                        >
                          <pre>{JSON.stringify(nodePayload, null, 2)}</pre>
                        </ScrollArea.Autosize>
                      </div>
                    )}
                  </div>
                );
              }

              if (event.event === 'agent_prompt') {
                const id = event.data.id;

                return (
                  <div
                    key={id}
                    className="run-timeline__item"
                    data-event="agent_prompt"
                  >
                    <span
                      className="run-timeline__tool"
                      data-collapsed={collapsed.includes(id)}
                      data-id={id}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(id) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span className="run-timeline__tool-title">
                        Agent prompt
                      </span>
                    </span>
                    {!collapsed.includes(id) && (
                      <div className="run-timeline__tool-content">
                        <ScrollArea.Autosize
                          mah="40dvh"
                          type="hover"
                          offsetScrollbars="present"
                        >
                          <pre>{event.data.systemPrompt}</pre>
                          <Divider />
                          <pre>{event.data.humanMessage}</pre>
                        </ScrollArea.Autosize>
                      </div>
                    )}
                  </div>
                );
              }

              if (event.event === 'subagent_error') {
                const id = event.data.id;

                return (
                  <div
                    key={id}
                    className="run-timeline__item"
                    data-event="subagent_error"
                  >
                    <span
                      className="run-timeline__tool"
                      data-collapsed={collapsed.includes(id)}
                      data-id={id}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(id) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span className="run-timeline__tool-title" data-errored>
                        Error
                      </span>
                    </span>
                    {!collapsed.includes(id) && (
                      <div className="run-timeline__tool-content">
                        <pre>{event.data.error}</pre>
                      </div>
                    )}
                  </div>
                );
              }

              if (event.event === 'context_usage') {
                const delta = contextDeltas.get(event) ?? 0;

                return (
                  <div
                    key={`context_usage:${event.data.timestamp}`}
                    className="run-timeline__item"
                    data-event="context_usage"
                  >
                    <div className="run-timeline__context">
                      <Icon as={IconGauge} />
                      <Text component="span" size="sm" c="dimmed">
                        {formatTokenCount(delta, true)} ·{' '}
                        {formatTokenCount(event.data.totalTokens)} total
                      </Text>
                    </div>
                  </div>
                );
              }

              if (event.event === 'queue_wait') {
                return (
                  <div
                    key={`queue_wait:${event.data.timestamp}`}
                    className="run-timeline__item"
                    data-event="queue_wait"
                  >
                    <div className="run-timeline__wait">
                      <Icon as={IconHourglass} />
                      <Text component="span" size="sm" c="dimmed">
                        Queued for {formatDuration(event.data.waitMs)}
                      </Text>
                    </div>
                  </div>
                );
              }

              if (event.event === 'llm_backend_wait_start') {
                const endEvent = llmBackendWaitEndById.get(event.data.id);
                const duration = endEvent
                  ? formatDuration(
                      endEvent.data.timestamp - event.data.timestamp,
                    )
                  : null;

                return (
                  <div
                    key={event.data.id}
                    className="run-timeline__item"
                    data-event="llm_backend_wait_start"
                  >
                    <div className="run-timeline__wait">
                      <Icon as={IconHourglass} />
                      <Text component="span" size="sm" c="dimmed">
                        {duration
                          ? `Waited ${duration} for ${event.data.provider}`
                          : `Waiting for ${event.data.provider}`}
                      </Text>
                    </div>
                  </div>
                );
              }

              if (event.event === 'summarize_context_start') {
                const id = event.data.id;
                const endEvent = summarizeContextEndById.get(id);
                const done =
                  !!endEvent &&
                  (endEvent.data.error === '' ||
                    endEvent.data.retries >= endEvent.data.maxRetries);
                const isRetrying = !!endEvent && !done;
                const duration = done
                  ? formatDuration(
                      endEvent.data.timestamp - event.data.timestamp,
                    )
                  : null;

                return (
                  <div
                    key={id}
                    className="run-timeline__item"
                    data-event="summarize_context_start"
                  >
                    <span
                      className="run-timeline__tool"
                      data-collapsed={collapsed.includes(id)}
                      data-id={id}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(id) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span
                        className="run-timeline__tool-title"
                        data-pending={
                          (!done && run.status === 'running') || undefined
                        }
                        data-errored={
                          (done && !!endEvent.data.error) || undefined
                        }
                      >
                        Summarize context
                        {isRetrying &&
                          `failed, retrying (${endEvent.data.retries}/${endEvent.data.maxRetries})`}
                      </span>
                      {duration && (
                        <Tooltip
                          label={new Date(
                            event.data.timestamp,
                          ).toLocaleString()}
                        >
                          <Text component="span" size="sm" c="dimmed" ml={8}>
                            {duration}
                          </Text>
                        </Tooltip>
                      )}
                    </span>
                    {!collapsed.includes(id) && (
                      <div className="run-timeline__tool-content">
                        <ScrollArea.Autosize
                          mah="40dvh"
                          type="hover"
                          offsetScrollbars="present"
                        >
                          <pre>{event.data.prompt}</pre>
                          {endEvent && (
                            <>
                              <Divider />
                              <pre>
                                {JSON.stringify(
                                  (() => {
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    const { id, timestamp, ...rest } =
                                      endEvent.data;
                                    return rest;
                                  })(),
                                  null,
                                  2,
                                )}
                              </pre>
                            </>
                          )}
                        </ScrollArea.Autosize>
                      </div>
                    )}
                  </div>
                );
              }

              if (
                event.event === 'comment_critic_start' ||
                event.event === 'reply_critic_start'
              ) {
                const id = event.data.id;
                const endEvent = criticEndById.get(id);
                const done = !!endEvent;
                const duration = done
                  ? formatDuration(
                      endEvent.data.timestamp - event.data.timestamp,
                    )
                  : null;

                return (
                  <div
                    key={id}
                    className="run-timeline__item"
                    data-event={event.event}
                  >
                    <span
                      className="run-timeline__tool"
                      data-collapsed={collapsed.includes(id)}
                      data-id={id}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(id) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span
                        className="run-timeline__tool-title"
                        data-pending={
                          (!done && run.status === 'running') || undefined
                        }
                        data-errored={!!endEvent?.data.error || undefined}
                      >
                        {event.event === 'reply_critic_start'
                          ? 'Reply critic'
                          : 'Comment critic'}
                      </span>
                      {duration && (
                        <Tooltip
                          label={new Date(
                            event.data.timestamp,
                          ).toLocaleString()}
                        >
                          <Text component="span" size="sm" c="dimmed" ml={8}>
                            {duration}
                          </Text>
                        </Tooltip>
                      )}
                    </span>
                    {!collapsed.includes(id) && (
                      <div className="run-timeline__tool-content">
                        <ScrollArea.Autosize
                          mah="40dvh"
                          type="hover"
                          offsetScrollbars="present"
                        >
                          <pre>{event.data.prompt}</pre>
                          {endEvent && (
                            <>
                              <Divider />
                              <pre>
                                {JSON.stringify(
                                  (() => {
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    const { id, timestamp, ...rest } =
                                      endEvent.data;
                                    return rest;
                                  })(),
                                  null,
                                  2,
                                )}
                              </pre>
                            </>
                          )}
                        </ScrollArea.Autosize>
                      </div>
                    )}
                  </div>
                );
              }

              if (event.event === 'corrective_nudge_start') {
                const id = event.data.id;
                const endEvent = correctiveNudgeEndById.get(id);
                const done = !!endEvent;
                const duration = done
                  ? formatDuration(
                      endEvent.data.timestamp - event.data.timestamp,
                    )
                  : null;
                const nudgeReason = {
                  DuplicateCallGuard: 'Tool call loop',
                  TrailingQuestionGuard: 'Task confirmation',
                  NoToolCallGuard: 'No action taken',
                  DiscussionCheckGuard: 'Discussion check',
                  ExtractProjectMemory: 'Memory reflection',
                  HumanApproval: 'Split approval',
                }[event.data.middleware];
                const label = `Corrective nudge (${nudgeReason})`;

                return (
                  <div
                    key={id}
                    className="run-timeline__item"
                    data-event="corrective_nudge_start"
                  >
                    <span
                      className="run-timeline__tool"
                      data-collapsed={collapsed.includes(id)}
                      data-id={id}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(id) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span
                        className="run-timeline__tool-title"
                        data-pending={
                          (!done && run.status === 'running') || undefined
                        }
                        data-errored={
                          (done && !!endEvent.data.error) || undefined
                        }
                      >
                        {label}
                      </span>
                      {duration && (
                        <Tooltip
                          label={new Date(
                            event.data.timestamp,
                          ).toLocaleString()}
                        >
                          <Text component="span" size="sm" c="dimmed" ml={8}>
                            {duration}
                          </Text>
                        </Tooltip>
                      )}
                    </span>
                    {!collapsed.includes(id) && (
                      <div className="run-timeline__tool-content">
                        <pre>{event.data.prompt}</pre>
                        {endEvent?.data.error && (
                          <>
                            <Divider />
                            <Text size="sm" c="red">
                              {endEvent.data.error}
                            </Text>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              if (event.event === 'extract_project_memory_start') {
                const id = event.data.id;
                const endEvent = extractProjectMemoryEndById.get(id);
                const done = !!endEvent;
                const duration = done
                  ? formatDuration(
                      endEvent.data.timestamp - event.data.timestamp,
                    )
                  : null;

                return (
                  <div
                    key={id}
                    className="run-timeline__item"
                    data-event="extract_project_memory_start"
                  >
                    <span
                      className="run-timeline__tool"
                      data-collapsed={collapsed.includes(id)}
                      data-id={id}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(id) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span
                        className="run-timeline__tool-title"
                        data-pending={
                          (!done && run.status === 'running') || undefined
                        }
                        data-errored={!!endEvent?.data.error || undefined}
                      >
                        Extract project memories (
                        {event.data.categories.join(', ')})
                      </span>
                      {duration && (
                        <Tooltip
                          label={new Date(
                            event.data.timestamp,
                          ).toLocaleString()}
                        >
                          <Text component="span" size="sm" c="dimmed" ml={8}>
                            {duration}
                          </Text>
                        </Tooltip>
                      )}
                    </span>
                    {!collapsed.includes(id) && (
                      <div className="run-timeline__tool-content">
                        <ScrollArea.Autosize
                          mah="40dvh"
                          type="hover"
                          offsetScrollbars="present"
                        >
                          <pre>{event.data.prompt}</pre>
                          {endEvent && (
                            <>
                              <Divider />
                              <pre>
                                {JSON.stringify(
                                  (() => {
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    const { id, timestamp, ...rest } =
                                      endEvent.data;
                                    return rest;
                                  })(),
                                  null,
                                  2,
                                )}
                              </pre>
                            </>
                          )}
                        </ScrollArea.Autosize>
                      </div>
                    )}
                  </div>
                );
              }

              if (event.event === 'model_retry') {
                const id = event.data.id;

                return (
                  <div
                    key={id}
                    className="run-timeline__item"
                    data-event="model_retry"
                  >
                    <span
                      className="run-timeline__retry"
                      data-collapsed={collapsed.includes(id)}
                      data-id={id}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(id) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span className="run-timeline__retry-label">
                        Model call failed, retrying ({event.data.count}/
                        {event.data.total})
                      </span>
                    </span>
                    {!collapsed.includes(id) && (
                      <Text size="sm" c="dimmed" pt="sm">
                        {event.data.error}
                      </Text>
                    )}
                  </div>
                );
              }

              if (event.event === 'message') {
                const eventId = event.data.id;
                return (
                  <div
                    key={eventId}
                    className="run-timeline__item"
                    data-event="message"
                  >
                    {event.data.reasoningContent && (
                      <div
                        className="run-timeline__reasoning"
                        data-collapsed={collapsed.includes(eventId)}
                        data-id={eventId}
                        onClick={onCollapse}
                      >
                        {collapsed.includes(eventId) ? (
                          <Icon as={IconChevronRight} />
                        ) : (
                          <Icon as={IconChevronDown} />
                        )}
                        <Text>Thinking</Text>
                      </div>
                    )}
                    {!collapsed.includes(eventId) && (
                      <div className="run-timeline__reasoning-content">
                        <Markdown content={event.data.reasoningContent} />
                      </div>
                    )}
                    {!!event.data.content.trim() && (
                      <Markdown content={event.data.content} />
                    )}
                  </div>
                );
              }

              if (event.event === 'tool_input') {
                const eventId = event.data.id;
                const output = toolOutputs.get(eventId);
                const parsedOutput =
                  typeof output === 'string'
                    ? safeJsonParse(output)
                    : undefined;
                const endTs = toolEndTs.get(eventId);
                const duration =
                  output && endTs
                    ? formatDuration(endTs - event.data.timestamp)
                    : null;

                if (event.data.name === 'spawn_subagent' && onOpenSubagent) {
                  const path = (event.data.input as { path?: string }).path;
                  const label = path ? `Verify ${path}` : 'Verifier';

                  return (
                    <div
                      key={eventId}
                      className="run-timeline__item"
                      data-event="tool_input"
                    >
                      <span
                        className="run-timeline__subagent"
                        data-id={eventId}
                        onClick={() => onOpenSubagent(eventId, label)}
                      >
                        <Icon as={IconRobot} />
                        <span
                          className="run-timeline__tool-title"
                          data-pending={
                            (!output && run.status === 'running') || undefined
                          }
                          data-errored={
                            !!(parsedOutput as { error?: unknown } | undefined)
                              ?.error || undefined
                          }
                        >
                          {label}
                        </span>
                        {duration ? (
                          <Text component="span" size="sm" c="dimmed" ml={8}>
                            {duration}
                          </Text>
                        ) : (
                          !output &&
                          run.status === 'running' && (
                            <Text component="span" size="sm" c="dimmed" ml={8}>
                              <Counter
                                mode="up"
                                startedAt={new Date(event.data.timestamp)}
                              />
                            </Text>
                          )
                        )}
                        <Icon as={IconChevronRight} />
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={eventId}
                    className="run-timeline__item"
                    data-event="tool_input"
                  >
                    <span
                      className="run-timeline__tool"
                      data-collapsed={collapsed.includes(eventId)}
                      data-id={eventId}
                      onClick={onCollapse}
                    >
                      {collapsed.includes(eventId) ? (
                        <Icon as={IconChevronRight} />
                      ) : (
                        <Icon as={IconChevronDown} />
                      )}
                      <span
                        className="run-timeline__tool-title"
                        data-pending={
                          (!output && run.status === 'running') || undefined
                        }
                        data-errored={
                          typeof output === 'string'
                            ? !!(
                                parsedOutput as
                                  | { error?: unknown; exitCode?: unknown }
                                  | undefined
                              )?.error ||
                              (event.data.name === 'run_command' &&
                                Number(
                                  (
                                    parsedOutput as
                                      { exitCode?: unknown } | undefined
                                  )?.exitCode,
                                ) !== 0)
                            : undefined
                        }
                      >
                        {event.data.name}
                      </span>
                      {duration && (
                        <Tooltip
                          label={new Date(
                            event.data.timestamp,
                          ).toLocaleString()}
                        >
                          <Text component="span" size="sm" c="dimmed" ml={8}>
                            {duration}
                          </Text>
                        </Tooltip>
                      )}
                    </span>
                    {!collapsed.includes(eventId) && (
                      <div className="run-timeline__tool-content">
                        <ScrollArea.Autosize
                          mah="40dvh"
                          type="hover"
                          offsetScrollbars="present"
                        >
                          <pre>
                            {JSON.stringify(event.data.input, null, 2).replace(
                              /\\n/g,
                              '\n',
                            )}
                          </pre>
                        </ScrollArea.Autosize>
                        {typeof output === 'string' && (
                          <>
                            <Divider />
                            <ScrollArea.Autosize
                              mah="40dvh"
                              type="hover"
                              offsetScrollbars="present"
                            >
                              <pre>
                                {parsedOutput === undefined
                                  ? output
                                  : JSON.stringify(
                                      parsedOutput,
                                      null,
                                      2,
                                    ).replace(/\\n/g, '\n')}
                              </pre>
                            </ScrollArea.Autosize>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              return null;
            })}

            {run.error && (
              <div className="run-timeline__item" data-event="error">
                <Text c="red">{run.error}</Text>
                {run.status === 'failed' && !hasCheckpoint && onRetry && (
                  <Button
                    variant="default"
                    size="compact-xs"
                    leftSection={<Icon as={IconRefresh} />}
                    onClick={() => onRetry(run.id)}
                    disabled={loading}
                  >
                    Retry
                  </Button>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
      {loading && !activeSubagentDone && <LoadingBubbles />}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
};

export default RunTimeline;
