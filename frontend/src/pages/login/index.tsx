import { use, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  Button,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconBrandGithub, IconBrandGitlab } from '@tabler/icons-react';

import { GitProvider } from '@/types';

import Icon from '@/components/icon';

import { authClient } from '@/api';
import logo from '@/assets/logo.svg';
import { config } from '@/config';
import { Context } from '@/contexts';
import { useAuth } from '@/hooks/useAuth';
import { useOAuthError } from '@/hooks/useOAuthError';

const CAPABILITIES = [
  'Live run streaming',
  'Workflow visibility',
  'Durable project memory',
];

const LoginPage = () => {
  const [pendingProvider, setPendingProvider] = useState<GitProvider | null>(
    null,
  );
  const { handleError } = use(Context);
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  useOAuthError('Failed to sign in');

  if (authLoading) {
    return (
      <Center h="100vh">
        <Loader color="gray" />
      </Center>
    );
  }

  if (user) {
    return <Navigate to={from ?? '/'} replace />;
  }

  const handleLogin = async (provider: GitProvider) => {
    setPendingProvider(provider);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: `${window.location.origin}${from ?? '/'}`,
      errorCallbackURL: `${window.location.origin}/login`,
    });
    if (error) handleError(error, 'Failed to sign in');
    setPendingProvider(null);
  };

  return (
    <div className="login-page">
      <Stack align="center" gap="xl" className="login-page__content">
        <div className="login-page__mark">
          <img alt="langgraph-harness" src={logo} height={64} width={64} />
        </div>
        <Stack align="center" gap={4}>
          <Title order={1} className="login-page__title">
            The AI coding agent platform for GitLab
          </Title>
          <Text
            c="dimmed"
            ta="center"
            maw={480}
            className="login-page__subtitle"
          >
            <Text component="span" c="blue" inherit>
              langgraph-harness
            </Text>{' '}
            reviews merge requests, resolves issues autonomously, and remembers
            what matters project by project — putting that context to work
            everywhere it operates.
          </Text>
        </Stack>
        <Group justify="center">
          <Button
            onClick={() => handleLogin(GitProvider.GitLab)}
            loading={pendingProvider === GitProvider.GitLab}
            disabled={pendingProvider === GitProvider.GitHub}
            leftSection={<Icon as={IconBrandGitlab} />}
            size="md"
          >
            Sign in with GitLab
          </Button>
          {config.githubSignIn && (
            <Button
              onClick={() => handleLogin(GitProvider.GitHub)}
              loading={pendingProvider === GitProvider.GitHub}
              disabled={pendingProvider === GitProvider.GitLab}
              leftSection={<Icon as={IconBrandGithub} />}
              size="md"
              variant="default"
            >
              Sign in with GitHub
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed" className="login-page__capabilities">
          {CAPABILITIES.join(' · ')}
        </Text>
      </Stack>
    </div>
  );
};

export default LoginPage;
