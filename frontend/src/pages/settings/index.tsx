import { use, useCallback, useEffect, useState } from 'react';
import {
  Anchor,
  Button,
  Card,
  Group,
  PasswordInput,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconBrandGithub,
  IconBrandGitlab,
  IconKey,
  IconLink,
  IconRefresh,
} from '@tabler/icons-react';

import { GitProvider } from '@/types';

import Icon from '@/components/icon';

import { api, authClient } from '@/api';
import { Context } from '@/contexts';
import { useAuth } from '@/hooks/useAuth';
import { useOAuthError } from '@/hooks/useOAuthError';

const CONNECTIONS = [
  {
    provider: GitProvider.GitLab,
    label: 'GitLab',
    icon: IconBrandGitlab,
    expiredText: 'Connection expired — reconnect to keep using GitLab tools',
  },
  {
    provider: GitProvider.GitHub,
    label: 'GitHub',
    icon: IconBrandGithub,
    expiredText: 'Connection expired — reconnect it',
  },
];

type Connection =
  | { state: 'loading' }
  | { state: 'connected'; username: string }
  | { state: 'not-connected' }
  | { state: 'expired' }
  | { state: 'check-failed' };

const SettingsPage = () => {
  const { handleError } = use(Context);
  const { providers } = useAuth();
  const enabledConnections = CONNECTIONS.filter(
    ({ provider }) => providers[provider],
  );
  const [connections, setConnections] = useState<
    Partial<Record<GitProvider, Connection>>
  >({});
  const [linking, setLinking] = useState<GitProvider | null>(null);
  useOAuthError('Failed to connect your account');

  const [openRouter, setOpenRouter] = useState<
    | { state: 'loading' }
    | { state: 'configured'; last4: string | null }
    | { state: 'unconfigured' }
    | { state: 'check-failed' }
  >({ state: 'loading' });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const loadOpenRouterStatus = useCallback(() => {
    api.settings['openrouter-key'].get().then(({ data, error }) => {
      if (error || !data) {
        handleError(error, 'Failed to check OpenRouter key status');
        setOpenRouter({ state: 'check-failed' });
        return;
      }
      setOpenRouter(
        data.configured
          ? { state: 'configured', last4: data.last4 }
          : { state: 'unconfigured' },
      );
    });
  }, [handleError]);

  useEffect(() => {
    const setConnection = (provider: GitProvider, connection: Connection) =>
      setConnections((prev) => ({ ...prev, [provider]: connection }));

    authClient.listAccounts().then(({ data: accounts, error }) => {
      if (error) {
        handleError(error, 'Failed to check connection status');
        for (const provider of Object.values(GitProvider)) {
          setConnection(provider, { state: 'check-failed' });
        }
        return;
      }

      for (const { provider, label } of CONNECTIONS) {
        const account = accounts?.find((a) => a.providerId === provider);
        if (!account) {
          setConnection(provider, { state: 'not-connected' });
          continue;
        }

        authClient
          .accountInfo({ query: { accountId: account.id } })
          .then(({ data, error }) => {
            // Covers an expired, revoked or undecryptable token: all fixed by linking again.
            if (error || !data) {
              setConnection(provider, { state: 'expired' });
              return;
            }
            const profile = data.data as { username?: string; login?: string };
            setConnection(provider, {
              state: 'connected',
              username:
                profile.username ??
                profile.login ??
                data.user.name ??
                `${label} account`,
            });
          });
      }
    });

    loadOpenRouterStatus();
  }, [handleError, loadOpenRouterStatus]);

  const handleLink = async (provider: GitProvider, label: string) => {
    setLinking(provider);
    const { error } = await authClient.linkSocial({
      provider,
      callbackURL: `${window.location.origin}/settings`,
      errorCallbackURL: `${window.location.origin}/settings`,
    });
    if (error) handleError(error, `Failed to connect ${label}`);
    setLinking(null);
  };

  const handleSaveOpenRouterKey = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;

    setSavingKey(true);
    const { error } = await api.settings['openrouter-key'].put({
      apiKey: trimmed,
    });
    setSavingKey(false);

    if (error) {
      handleError(error, 'Failed to save OpenRouter key');
      return;
    }

    setApiKeyInput('');
    loadOpenRouterStatus();
  };

  return (
    <Stack className="settings-page" gap="md">
      <Title order={2} visibleFrom="sm">
        Settings
      </Title>

      {enabledConnections.length > 0 && <Text fw={600}>Connections</Text>}

      {enabledConnections.map(({ provider, label, icon, expiredText }) => {
        const connection = connections[provider] ?? { state: 'loading' };
        const canLink =
          connection.state === 'not-connected' ||
          connection.state === 'expired';

        return (
          <Card
            key={provider}
            withBorder
            radius="md"
            className="settings-page__card"
          >
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <Icon as={icon} size={20} />
                <Stack gap={0}>
                  <Text fw={600} size="sm">
                    {label}
                  </Text>
                  {connection.state === 'loading' ? (
                    <Text size="xs" c="dimmed">
                      Checking connection...
                    </Text>
                  ) : connection.state === 'connected' ? (
                    <Text size="xs" c="dimmed">
                      Connected as @{connection.username}
                    </Text>
                  ) : connection.state === 'check-failed' ? (
                    <Text size="xs" c="dimmed">
                      Failed to check {label} connection status
                    </Text>
                  ) : connection.state === 'not-connected' ? (
                    <Text size="xs" c="dimmed">
                      Not connected
                    </Text>
                  ) : (
                    <Text size="xs" c="red">
                      {expiredText}
                    </Text>
                  )}
                </Stack>
              </Group>

              {canLink && (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={
                    <Icon
                      as={
                        connection.state === 'expired' ? IconRefresh : IconLink
                      }
                      size={16}
                    />
                  }
                  loading={linking === provider}
                  disabled={linking !== null && linking !== provider}
                  onClick={() => handleLink(provider, label)}
                >
                  {connection.state === 'expired' ? 'Reconnect' : 'Connect'}
                </Button>
              )}
            </Group>
          </Card>
        );
      })}

      <Text fw={600}>API keys</Text>

      <Card withBorder radius="md" className="settings-page__card">
        <Stack gap="sm">
          <Group gap="sm" wrap="nowrap">
            <Icon as={IconKey} size={20} />
            <Stack gap={0}>
              <Text fw={600} size="sm">
                OpenRouter
              </Text>
              {openRouter.state === 'loading' ? (
                <Text size="xs" c="dimmed">
                  Checking...
                </Text>
              ) : openRouter.state === 'configured' ? (
                <Text size="xs" c="dimmed">
                  Key saved, ending in •••{openRouter.last4}
                </Text>
              ) : openRouter.state === 'check-failed' ? (
                <Text size="xs" c="dimmed">
                  Failed to check OpenRouter key status
                </Text>
              ) : (
                <Text size="xs" c="red">
                  No key saved — required to use chat
                </Text>
              )}
            </Stack>
          </Group>

          <Group align="flex-end" gap="xs" wrap="nowrap">
            <PasswordInput
              flex={1}
              placeholder={
                openRouter.state === 'configured'
                  ? 'Enter a new key to replace it'
                  : 'sk-or-...'
              }
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.currentTarget.value)}
            />
            <Button
              onClick={handleSaveOpenRouterKey}
              loading={savingKey}
              disabled={!apiKeyInput.trim()}
            >
              Save
            </Button>
          </Group>

          <Anchor
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
          >
            Get an OpenRouter key
          </Anchor>
        </Stack>
      </Card>
    </Stack>
  );
};

export default SettingsPage;
