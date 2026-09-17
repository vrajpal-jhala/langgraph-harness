import type { TooltipRenderProps } from 'react-joyride';
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import Icon from '@/components/icon';

const TourTooltip = ({
  step,
  index,
  size,
  isLastStep,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  tooltipProps,
}: TooltipRenderProps) => (
  <Card
    {...tooltipProps}
    withBorder
    radius="md"
    padding="md"
    shadow="lg"
    w={360}
    className="tour-tooltip"
  >
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        {step.title && (
          <Title order={5} className="tour-tooltip__title">
            {step.title}
          </Title>
        )}
        <ActionIcon {...closeProps} variant="subtle" color="gray" size="sm">
          <Icon as={IconX} />
        </ActionIcon>
      </Group>

      <Text size="sm" c="dimmed">
        {step.content}
      </Text>

      <Group justify="space-between" align="center" mt="xs">
        <Text size="xs" c="dimmed">
          {index + 1} of {size}
        </Text>
        <Group gap="xs">
          {index > 0 && (
            <Button {...backProps} variant="default" size="xs">
              Back
            </Button>
          )}
          {!isLastStep && (
            <Button {...skipProps} variant="subtle" color="gray" size="xs">
              Skip
            </Button>
          )}
          <Button {...primaryProps} size="xs">
            {isLastStep ? 'Done' : 'Next'}
          </Button>
        </Group>
      </Group>
    </Stack>
  </Card>
);

export default TourTooltip;
