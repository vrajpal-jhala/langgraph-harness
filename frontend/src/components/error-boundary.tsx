import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Center, EmptyState, Flex } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCopy, IconRefresh } from '@tabler/icons-react';

import Icon from '@/components/icon';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// Class component because React only supports error boundaries via componentDidCatch/getDerivedStateFromError — no hook equivalent exists.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error) {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
  }

  handleCopy = () => {
    const { error, errorInfo } = this.state;
    const report = [
      `Time: ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      `User agent: ${navigator.userAgent}`,
      '',
      `${error?.name ?? 'Error'}: ${error?.message ?? '(no message)'}`,
      error?.stack ?? '',
      errorInfo?.componentStack ?? '',
    ].join('\n');

    navigator.clipboard.writeText(report).then(
      () =>
        notifications.show({ message: 'Crash report copied', color: 'green' }),
      () =>
        notifications.show({
          message: 'Failed to copy — check browser permissions',
          color: 'yellow',
        }),
    );
  };

  render() {
    if (!this.state.error) return this.props.children;

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
          title="Something went wrong"
          description="langgraph-harness hit an unexpected error and can't continue on this page. Reloading usually fixes it — if it keeps happening, copy the crash report below and send it to the team."
          size="md"
        >
          <EmptyState.Actions mt="lg">
            <Flex direction="column" gap="xs" align="center">
              <Button
                variant="default"
                size="sm"
                onClick={this.handleCopy}
                leftSection={<Icon as={IconCopy} size={16} />}
              >
                Copy crash report
              </Button>
              <Button
                size="sm"
                onClick={() => window.location.reload()}
                leftSection={<Icon as={IconRefresh} size={16} />}
              >
                Reload page
              </Button>
            </Flex>
          </EmptyState.Actions>
        </EmptyState>
      </Center>
    );
  }
}
