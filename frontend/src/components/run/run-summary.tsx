import { Alert, EmptyState, Flex, Loader } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

import type { Run } from '@/types';

import Icon from '@/components/icon';
import { Markdown } from '@/components/markdown';

interface IRunSummaryProps {
  run: Run | null;
}

const RunSummary = ({ run }: IRunSummaryProps) => {
  let summary;

  if (!run) {
    summary = null;
  } else {
    const currentNode =
      [...run.events].reverse().find((e) => e.event === 'node_start')?.data
        .node ?? null;

    if (run.status === 'running' || run.status === 'queued') {
      summary = (
        <EmptyState
          mt="xl"
          icon={<Loader color="gray" />}
          title={currentNode ?? 'Running...'}
          description="Summary will appear here after completion."
          size="md"
        />
      );
    } else if (run.status === 'failed') {
      summary = (
        <Alert
          color="red"
          title={currentNode ? `Failed at ${currentNode} node` : 'Failed'}
          icon={<Icon as={IconAlertCircle} size={20} />}
          withCloseButton={false}
        >
          {run.error ?? 'Run failed with an unknown error.'}
        </Alert>
      );
    } else if (run.status === 'completed') {
      const finalMessage =
        [...run.events].reverse().find((e) => e.event === 'message')?.data
          .content ?? null;

      summary = finalMessage ? (
        <Markdown content={finalMessage} />
      ) : (
        <Flex c="dimmed" p="lg" justify="center">
          No summary available.
        </Flex>
      );
    }
  }

  return <div className="run-summary">{summary}</div>;
};

export default RunSummary;
