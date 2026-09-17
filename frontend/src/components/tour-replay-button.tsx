import { ActionIcon, Tooltip } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';

import Icon from './icon';

import { useTour } from '@/tours/tourState';
import type { TourStepConfig } from '@/tours/types';

const TourReplayButton = ({
  tourId,
  steps,
}: {
  tourId: string;
  steps: TourStepConfig[];
}) => {
  const { startTour } = useTour();

  return (
    <Tooltip label="Replay tour">
      <ActionIcon
        variant="subtle"
        color="gray"
        onClick={() => startTour(tourId, steps, { force: true })}
        aria-label="Replay tour"
      >
        <Icon as={IconHelpCircle} />
      </ActionIcon>
    </Tooltip>
  );
};

export default TourReplayButton;
