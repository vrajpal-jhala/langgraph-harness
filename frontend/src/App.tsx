import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button, Center, EmptyState, Loader } from '@mantine/core';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';

import Icon from '@/components/icon';
import AnalyticsPage from './pages/analytics/index';
import ChatPage from './pages/chat/index';
import ChatListPage from './pages/chat-list/index';
import DashboardPage from './pages/dashboard/index';
import Layout from './pages/Layout';
import LoginPage from './pages/login/index';
import MemoriesPage from './pages/memories/index';
import MonitoringPage from './pages/monitoring/index';
import ScheduleDetailPage from './pages/schedules/detail';
import SchedulesPage from './pages/schedules/index';
import SettingsPage from './pages/settings/index';
import ThreadDetailPage from './pages/thread-detail/index';
import Threads from './pages/threads/index';
import WorkflowDetailPage from './pages/workflow-detail/index';
import WorkflowsPage from './pages/workflows/index';
import { TourProvider } from './tours/TourProvider';

import { useAuth } from '@/hooks/useAuth';

const RequireAuth = () => {
  const { user, loading, checkFailed, retry } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Center h="100vh">
        <Loader color="gray" />
      </Center>
    );
  }
  if (checkFailed) {
    return (
      <Center h="100vh">
        <EmptyState
          icon={
            <Icon
              as={IconAlertTriangle}
              size={40}
              color="var(--mantine-color-red-text)"
            />
          }
          title="Failed to verify your session"
          description="This is usually a brief server hiccup — try again in a moment."
          size="md"
        >
          <EmptyState.Actions mt="lg">
            <Button
              size="sm"
              onClick={retry}
              leftSection={<Icon as={IconRefresh} size={16} />}
            >
              Retry
            </Button>
          </EmptyState.Actions>
        </EmptyState>
      </Center>
    );
  }
  if (!user) {
    return (
      <Navigate
        to="/login"
        state={{ from: `${location.pathname}${location.search}` }}
        replace
      />
    );
  }

  return (
    <TourProvider>
      <Layout />
    </TourProvider>
  );
};

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth />}>
        <Route index element={<Navigate to="/threads" />} />
        <Route path="threads" element={<Threads />} />
        <Route path="threads/:threadId" element={<ThreadDetailPage />} />
        <Route path="chat" element={<ChatListPage />} />
        <Route path="chat/:threadId" element={<ChatPage />} />
        <Route path="schedules" element={<SchedulesPage />} />
        <Route path="schedules/:id" element={<ScheduleDetailPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="workflows/:workflowId" element={<WorkflowDetailPage />} />
        <Route path="memories" element={<MemoriesPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="monitoring" element={<MonitoringPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
