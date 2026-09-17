import { Box, Group, Text, Tooltip } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';

import Icon from '@/components/icon';

interface Stat {
  color: string;
  label: string;
  value: number;
  tooltip?: string;
}

interface IStatSummaryProps {
  title: string;
  tooltip: string;
  dataTour?: string;
  stats: Stat[];
}

const StatSummary = ({
  title,
  tooltip,
  dataTour,
  stats,
}: IStatSummaryProps) => {
  if (!stats.length) return null;

  return (
    <>
      <Group gap={5} py="xs" data-tour={dataTour}>
        <Text size="sm">{title}</Text>
        <Tooltip label={tooltip} multiline w={220}>
          <Icon as={IconHelpCircle} />
        </Tooltip>
      </Group>
      <Group gap="sm" wrap="wrap">
        {stats.map((s) => (
          <Group key={s.label} gap={6} wrap="nowrap" align="center">
            <Box w={8} h={8} bg={`${s.color}.6`} />
            <Text size="xs" c="dimmed">
              {s.value} {s.label}
            </Text>
            {s.tooltip && (
              <Tooltip label={s.tooltip} multiline w={220}>
                <Icon as={IconHelpCircle} size={12} />
              </Tooltip>
            )}
          </Group>
        ))}
      </Group>
    </>
  );
};

export default StatSummary;
