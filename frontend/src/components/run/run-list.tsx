import { Indicator, NavLink, Text, Tooltip } from '@mantine/core';
import { IconGitBranch } from '@tabler/icons-react';

import type { Run } from '@/types';

import Counter from '@/components/counter';
import Icon from '@/components/icon';

import { RUN_STATUS_COLOR } from '@/constants';
import { formatDuration, formatTokenCount, getRunContextUsage } from '@/utils';

interface IRunListItemProps {
  run: Run;
  index: number;
  parentIndex: number | null;
  isSelected: boolean;
  onSelect: () => void;
  contextWindow: number | undefined;
  precedingContextTotal: number;
}

const RunListItem = ({
  run,
  index,
  parentIndex,
  isSelected,
  onSelect,
  contextWindow,
  precedingContextTotal,
}: IRunListItemProps) => {
  const isTerminal = run.status === 'completed' || run.status === 'failed';
  const durationMs =
    isTerminal && run.started_at && run.completed_at
      ? +new Date(run.completed_at) - +new Date(run.started_at)
      : null;
  const durationEl =
    durationMs !== null ? (
      <Text size="xs" c="dimmed">
        {formatDuration(durationMs)}
      </Text>
    ) : run.status === 'running' && run.started_at ? (
      <Text size="xs" c="dimmed">
        <Counter mode="up" startedAt={run.started_at} />
      </Text>
    ) : null;

  const contextUsage = getRunContextUsage(run, precedingContextTotal);
  const contextEl = contextUsage ? (
    <Text size="xs" c="dimmed">
      {formatTokenCount(contextUsage.totalTokens)}
      {contextWindow
        ? ` / ${formatTokenCount(contextWindow)} (${Math.round((contextUsage.totalTokens / contextWindow) * 100)}%)`
        : ' tokens'}
    </Text>
  ) : null;

  return (
    <NavLink
      component="button"
      type="button"
      label={`Run ${index + 1}`}
      color="gray"
      leftSection={
        !!parentIndex && (
          <Tooltip label={`Forked from Run ${parentIndex}`}>
            <Icon as={IconGitBranch} />
          </Tooltip>
        )
      }
      rightSection={
        <Indicator variant="dot" color={RUN_STATUS_COLOR[run.status]} />
      }
      description={
        run.status !== 'queued' &&
        !!run.started_at && (
          <>
            {durationEl}
            {contextEl}
          </>
        )
      }
      active={isSelected}
      onClick={onSelect}
    />
  );
};

interface IRunListProps {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  contextWindowByModel: Record<string, number>;
  precedingContextTotalByRunId: Record<string, number>;
}

const RunList = ({
  runs,
  selectedRunId,
  onSelect,
  contextWindowByModel,
  precedingContextTotalByRunId,
}: IRunListProps) => {
  const checkpointToRunIndex = new Map<string, number>();

  runs.forEach((run, idx) => {
    run.events.forEach((e) => {
      if (e.event === 'checkpoint' && !checkpointToRunIndex.has(e.data.id))
        checkpointToRunIndex.set(e.data.id, idx + 1);
    });
  });

  return runs
    .map((run, idx) => ({
      run,
      index: idx,
      parentIndex: run.parent_checkpoint_id
        ? (checkpointToRunIndex.get(run.parent_checkpoint_id) ?? null)
        : null,
    }))
    .reverse()
    .map(({ run, index, parentIndex }) => (
      <RunListItem
        key={run.id}
        run={run}
        index={index}
        parentIndex={parentIndex}
        isSelected={selectedRunId === run.id}
        onSelect={() => onSelect(run.id)}
        contextWindow={contextWindowByModel[run.input.model]}
        precedingContextTotal={precedingContextTotalByRunId[run.id] ?? 0}
      />
    ));
};

export default RunList;
