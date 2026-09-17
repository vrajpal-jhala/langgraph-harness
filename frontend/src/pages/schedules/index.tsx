import { Link } from 'react-router-dom';
import { Alert, Button, Group, Stack, Title } from '@mantine/core';
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react';

import { Role } from '@/types';

import Icon from '@/components/icon';
import SchedulesList from './list';

import { useAuth } from '@/hooks/useAuth';

const SchedulesPage = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === Role.Admin;

  if (!user) return null;

  return (
    <Stack className="schedules-page" gap="md">
      <Group justify="space-between">
        <Title order={2} visibleFrom="sm">
          Schedules
        </Title>
        {isAdmin && (
          <Button
            component={Link}
            to="/schedules/new"
            leftSection={<Icon as={IconPlus} />}
          >
            New task
          </Button>
        )}
      </Group>

      {!isAdmin && (
        <Alert color="yellow" icon={<Icon as={IconAlertTriangle} />}>
          Submitting or managing tasks is restricted to admins — the list below
          is read-only.
        </Alert>
      )}

      <SchedulesList canManage={isAdmin} />
    </Stack>
  );
};

export default SchedulesPage;
