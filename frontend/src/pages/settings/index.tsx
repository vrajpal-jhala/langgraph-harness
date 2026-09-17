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
import { IconBrandGitlab, IconKey, IconRefresh } from '@tabler/icons-react';

import Icon from '@/components/icon';

import { api, authClient } from '@/api';
import { Context } from '@/contexts';
import { useOAuthError } from '@/hooks/useOAuthError';

const SettingsPage = () => {
  const { handleError } = use(Context);
  const [gitlab, setGitlab] = useState<
    | { state: 'loading' }
    | { state: 'connected'; username: string }
    | { state: 'disconnected' }
    | { state: 'check-failed' }
  >({ state: 'loading' });
  const [reconnecting, setReconnecting] = useState(false);
  useOAuthError('Failed to reconnect GitLab');

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
    authClient.listAccounts().then(({ data: accounts, error }) => {
      if (error) {
        handleError(error, 'Failed to check GitLab connection status');
        setGitlab({ state: 'check-failed' });
        return;
      }

      const gitlabAccount = accounts?.find((a) => a.providerId === 'gitlab');
      if (!gitlabAccount) {
        setGitlab({ state: 'disconnected' });
        return;
      }

      authClient
        .accountInfo({
          query: { accountId: gitlabAccount.id },
        })
        .then(({ data, error }) => {
          // A stored-but-unusable token (expired/revoked/undecryptable) needs the same fix as never connecting, so both cases route to 'disconnected'.
          if (error || !data) {
            setGitlab({ state: 'disconnected' });
            return;
          }
          const profile = data.data as { username?: string };
          setGitlab({
            state: 'connected',
            username: profile.username ?? data.user.name ?? 'GitLab account',
          });
        });
    });

    loadOpenRouterStatus();
  }, [handleError, loadOpenRouterStatus]);

  const handleReconnect = async () => {
    setReconnecting(true);
    const { error } = await authClient.linkSocial({
      provider: 'gitlab',
      callbackURL: `${window.location.origin}/settings`,
      errorCallbackURL: `${window.location.origin}/settings`,
    });
    if (error) handleError(error, 'Failed to reconnect GitLab');
    setReconnecting(false);
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

      <Text fw={600}>Connections</Text>

      <Card withBorder radius="md" className="settings-page__card">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Icon as={IconBrandGitlab} size={20} />
            <Stack gap={0}>
              <Text fw={600} size="sm">
                GitLab
              </Text>
              {gitlab.state === 'loading' ? (
                <Text size="xs" c="dimmed">
                  Checking connection...
                </Text>
              ) : gitlab.state === 'connected' ? (
                <Text size="xs" c="dimmed">
                  Connected as @{gitlab.username}
                </Text>
              ) : gitlab.state === 'check-failed' ? (
                <Text size="xs" c="dimmed">
                  Failed to check GitLab connection status
                </Text>
              ) : (
                <Text size="xs" c="red">
                  Connection expired — reconnect to keep using GitLab tools
                </Text>
              )}
            </Stack>
          </Group>

          {gitlab.state === 'disconnected' && (
            <Group gap="xs" wrap="nowrap">
              <Button
                size="xs"
                variant="default"
                leftSection={<Icon as={IconRefresh} size={16} />}
                loading={reconnecting}
                onClick={handleReconnect}
              >
                Reconnect
              </Button>
            </Group>
          )}
        </Group>
      </Card>

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
