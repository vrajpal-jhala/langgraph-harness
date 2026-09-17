import { use, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ActionIcon, Card, Group, Skeleton, Stack, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';

import { Role, type TaskSchedule } from '@/types';

import Icon from '@/components/icon';
import { ScheduleForm } from './form';

import { api } from '@/api';
import { Context } from '@/contexts';
import { useAuth } from '@/hooks/useAuth';

const ScheduleDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { user } = useAuth();
  const { handleError } = use(Context);
  const [schedule, setSchedule] = useState<TaskSchedule | null>(null);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    if (isNew || !id) return;
    api
      .schedules({ id })
      .get()
      .then(({ data, error }) => {
        setLoading(false);
        if (error) return handleError(error.value, 'Failed to load schedule');
        setSchedule(data);
      });
  }, [id, isNew, handleError]);

  if (!user) return null;
  if (user.role !== Role.Admin) return <Navigate to="/schedules" replace />;

  return (
    <Stack className="schedules-page" gap="md">
      <Group gap="xs">
        <ActionIcon
          component={Link}
          to="/schedules"
          variant="subtle"
          color="gray"
          aria-label="Back to schedules"
        >
          <Icon as={IconArrowLeft} />
        </ActionIcon>
        <Title order={2}>{isNew ? 'New task' : 'Edit schedule'}</Title>
      </Group>

      <Card withBorder radius="md" padding="md">
        {isNew ? (
          <ScheduleForm />
        ) : loading ? (
          <Skeleton height={300} radius="sm" />
        ) : schedule ? (
          <ScheduleForm schedule={schedule} />
        ) : null}
      </Card>
    </Stack>
  );
};

export default ScheduleDetailPage;
