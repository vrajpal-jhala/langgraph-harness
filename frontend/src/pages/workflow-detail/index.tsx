import { use, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';

import type { Workflow } from '@/types';

import Icon from '@/components/icon';
import MermaidGraph from '@/components/mermaid-graph';
import TourReplayButton from '@/components/tour-replay-button';

import { api } from '@/api';
import { WORKFLOW_STATUS_COLOR } from '@/constants';
import { Context } from '@/contexts';
import { WORKFLOW_DETAIL_TOUR_ID, workflowDetailSteps } from '@/tours/steps';
import { hasSeenTour, useTour } from '@/tours/tourState';

const WorkflowDetailPage = () => {
  const { workflowId } = useParams();
  const navigate = useNavigate();
  const { handleError } = use(Context);
  const { startTour } = useTour();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [graph, setGraph] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedWorkflowId, setLoadedWorkflowId] = useState(workflowId);

  // Drops stale content during render, before paint, so a new workflowId never flashes the old workflow.
  if (workflowId !== loadedWorkflowId) {
    setLoadedWorkflowId(workflowId);
    setWorkflow(null);
    setGraph(null);
    setLoading(true);
  }

  useEffect(() => {
    if (loading || !graph || hasSeenTour(WORKFLOW_DETAIL_TOUR_ID)) return;
    startTour(WORKFLOW_DETAIL_TOUR_ID, workflowDetailSteps);
  }, [loading, graph, startTour]);

  useEffect(() => {
    if (!workflowId) return;

    Promise.all([
      api.workflows({ id: workflowId }).get(),
      api.workflows({ id: workflowId }).graph.get(),
    ]).then(([workflowRes, graphRes]) => {
      if (workflowRes.error || graphRes.error) {
        handleError(
          workflowRes.error?.value ?? graphRes.error?.value,
          'Failed to load workflow',
        );
        setLoading(false);
        navigate('/workflows');
        return;
      }
      setWorkflow(workflowRes.data);
      setGraph(graphRes.data.mermaid);
      setLoading(false);
    });
  }, [workflowId, handleError, navigate]);

  return (
    <Stack className="workflow-detail" gap="md">
      <Group className="workflow-detail__header" gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => navigate('/workflows')}
          aria-label="Back to workflows"
        >
          <Icon as={IconArrowLeft} />
        </ActionIcon>
        {workflow ? (
          <>
            <Title order={4}>{workflow.name}</Title>
            <Badge
              color={WORKFLOW_STATUS_COLOR[workflow.status]}
              size="sm"
              tt="capitalize"
              data-tour="workflow-status"
            >
              {workflow.status}
            </Badge>
            <TourReplayButton
              tourId={WORKFLOW_DETAIL_TOUR_ID}
              steps={workflowDetailSteps}
            />
          </>
        ) : (
          <Skeleton height={20} width={180} radius="sm" />
        )}
      </Group>

      <ScrollArea flex={1} h={0} type="hover" offsetScrollbars="y">
        <Card
          className="workflow-detail__body"
          withBorder
          radius="md"
          padding="md"
          data-tour="workflow-graph"
        >
          <Text size="sm" fw={500} mb="sm">
            Execution graph
          </Text>
          {loading || !graph ? (
            <Skeleton height={200} radius="sm" />
          ) : (
            <MermaidGraph definition={graph} />
          )}
        </Card>
      </ScrollArea>
    </Stack>
  );
};

export default WorkflowDetailPage;
