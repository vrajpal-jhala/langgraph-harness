import {
  Group,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';

import type { Run } from '@/types';

import Icon from '@/components/icon';

import { getRunMode, isChatRunInput } from '@/utils';

interface IQueryListProps {
  runs: Run[];
  selectedRunId: string | null;
}

const QueryList = ({ runs, selectedRunId }: IQueryListProps) => (
  <Stack className="query-list" gap={4} h="100%">
    <Group gap={4} py="xs" data-tour="chat-query-list">
      <Text size="sm">History</Text>
      <Tooltip label="Each entry is a message you've sent — click one to jump to it in the conversation">
        <Icon as={IconHelpCircle} />
      </Tooltip>
    </Group>
    <ScrollArea type="hover" offsetScrollbars="present" flex={1} mih={0}>
      {runs.map((run) => {
        // A retry replays its ancestor's query — the ancestor's row already covers this turn.
        if (isChatRunInput(run.input) && getRunMode(run) !== 'fresh') {
          return null;
        }

        const message = isChatRunInput(run.input)
          ? run.input.query.message
          : '';
        return (
          <NavLink
            key={run.id}
            component="a"
            href={`#run-${run.id}`}
            active={run.id === selectedRunId}
            color="gray"
            label={
              <Text size="sm" truncate>
                {message || 'Message'}
              </Text>
            }
          />
        );
      })}
    </ScrollArea>
  </Stack>
);

export default QueryList;
