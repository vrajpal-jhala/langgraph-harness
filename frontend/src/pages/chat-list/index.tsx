import { type MouseEvent, use, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  Button,
  Card,
  Center,
  Divider,
  EmptyState,
  Group,
  Indicator,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconMessagePlus, IconSearch, IconTrash } from '@tabler/icons-react';

import type { Thread } from '@/types';

import Icon from '@/components/icon';

import { api, ws } from '@/api';
import { CHAT_STATUS_COLOR } from '@/constants';
import { Context } from '@/contexts';
import { useConfirmAction } from '@/hooks/useConfirmAction';
import { formatDate } from '@/utils';

const CHATS_LIMIT = 50;

const ChatListPage = () => {
  const navigate = useNavigate();
  const { handleError } = use(Context);
  const [chats, setChats] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const deleteChat = useConfirmAction<Thread>({
    title: 'Delete chat',
    message: (chat) => `Delete "${chat?.title}"? This can't be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
  });

  // One effect, not one per trigger — splitting would let a re-run see a stale search/page value from another effect's closure.
  useEffect(() => {
    const t = setTimeout(() => {
      api.threads
        .get({
          query: {
            kinds: ['chat'],
            title: search || undefined,
            limit: CHATS_LIMIT,
            offset: (page - 1) * CHATS_LIMIT,
          },
        })
        .then(({ data, error }) => {
          if (error) handleError(error.value, 'Failed to fetch chats');
          if (data) {
            setChats(data.data);
            setTotalPages(Math.max(1, Math.ceil(data.total / CHATS_LIMIT)));
          }
          setLoading(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [search, page, refreshKey, handleError]);

  // Refreshes the list on every server push — covers the first-message auto-rename (chat workflow's buildInput) and live status markers.
  useEffect(() => {
    const socket = ws.subscribe();
    socket.on('error', (e) => console.error('[ws] error', e));
    socket.subscribe(({ data }) => {
      if (data.type !== 'thread:upserted') return;
      setRefreshKey((k) => k + 1);
    });
    return () => {
      socket.close();
    };
  }, []);

  // Chat threads are owned by their creator, so this skips the admin-only confirm gate mr-review deletion uses — a plain confirmation is enough.
  const handleDeleteChat = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const { id } = e.currentTarget.dataset;
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    deleteChat.request(async () => {
      const { error } = await api.threads({ id: chat.id }).delete();
      if (error) {
        handleError(error.value, 'Failed to delete chat');
        return;
      }
      setChats((prev) => prev.filter((c) => c.id !== chat.id));
    }, chat);
  };

  return (
    <Stack className="chat-list-page" gap="md">
      <Group justify="space-between">
        <Title order={2} visibleFrom="sm">
          Chats
        </Title>
        <Button
          leftSection={<Icon as={IconMessagePlus} />}
          onClick={() => navigate('/chat/new')}
        >
          New chat
        </Button>
      </Group>

      <TextInput
        placeholder="Search by title"
        leftSection={<Icon as={IconSearch} />}
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
          setPage(1);
        }}
      />

      <Divider />

      {loading ? (
        <Stack gap="xs">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={52} radius="md" />
          ))}
        </Stack>
      ) : !chats.length ? (
        <Center className="chat-empty">
          <EmptyState
            icon={<Icon as={IconMessagePlus} size={40} />}
            title="No chats yet"
            description="Start a new chat to talk to the GitLab-aware assistant."
            size="md"
          />
        </Center>
      ) : (
        <Stack gap="xs">
          {chats.map((chat) => {
            const upd = formatDate(chat.updated_at);
            // Marker only appears with signal: blue while streaming, red on failure, yellow awaiting approval; completed shows nothing.
            const marker = chat.latest_run_status && (
              <Indicator
                color={CHAT_STATUS_COLOR[chat.latest_run_status]}
                size={8}
                position="middle-center"
                mx={4}
              />
            );
            return (
              <Card
                key={chat.id}
                withBorder
                radius="md"
                padding="sm"
                className="chat-card"
                onClick={() => navigate(`/chat/${chat.id}`)}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    {marker}
                    <Text size="sm" fw={500} truncate>
                      {chat.title}
                    </Text>
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    {upd && (
                      <Tooltip label={upd.full}>
                        <Text size="xs" c="dimmed">
                          {upd.display}
                        </Text>
                      </Tooltip>
                    )}
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      data-id={chat.id}
                      onClick={handleDeleteChat}
                      aria-label="Delete chat"
                    >
                      <Icon as={IconTrash} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}

      {totalPages > 1 && (
        <Group justify="center" mt="sm">
          <Button
            variant="transparent"
            size="compact-xs"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Text size="sm" c="dimmed">
            Page {page}
          </Text>
          <Button
            variant="transparent"
            size="compact-xs"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </Group>
      )}

      {deleteChat.modal}
    </Stack>
  );
};

export default ChatListPage;
