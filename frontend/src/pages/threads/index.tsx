import { type MouseEvent, use, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  Divider,
  EmptyState,
  Group,
  MultiSelect,
  ScrollArea,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconSearch, IconStack2, IconTrash } from '@tabler/icons-react';

import { Role, type RunKind, type Thread } from '@/types';

import Counter from '@/components/counter';
import Icon from '@/components/icon';

import { api, ws } from '@/api';
import { RUN_STATUS_COLOR } from '@/constants';
import { Context } from '@/contexts';
import { useAuth } from '@/hooks/useAuth';
import { useConfirmAction } from '@/hooks/useConfirmAction';
import { formatDate, formatDuration } from '@/utils';

const THREADS_LIMIT = 20;

const ThreadsPage = () => {
  const navigate = useNavigate();
  const theme = useMantineTheme();
  const isMobile =
    useMediaQuery(`(max-width: ${theme.breakpoints.sm})`) ?? false;
  const { handleError } = use(Context);
  const { user } = useAuth();
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [kindFilters, setKindFilters] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const deleteThread = useConfirmAction<Thread>({
    title: 'Delete thread',
    message: (thread) => `Delete "${thread?.title}"? This can't be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
  });

  // Resets to page 1 and flags loading in the same render as the filter's own setState, not a separate effect.
  const filterProjects = (values: string[]) => {
    setProjectFilters(values);
    setPage(1);
    setLoadingThreads(true);
  };
  const filterStatuses = (values: string[]) => {
    setStatusFilters(values);
    setPage(1);
    setLoadingThreads(true);
  };
  const filterKinds = (values: string[]) => {
    setKindFilters(values);
    setPage(1);
    setLoadingThreads(true);
  };
  const filterSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    setLoadingThreads(true);
  };

  // Debounced so free-text search doesn't fire a request per keystroke; fetch whenever page or filters change, or a WS push asks for a refresh.
  useEffect(() => {
    const t = setTimeout(() => {
      api.threads
        .get({
          query: {
            kinds: kindFilters as RunKind[],
            projects: projectFilters,
            statuses: statusFilters,
            title: search || undefined,
            limit: THREADS_LIMIT,
            offset: (page - 1) * THREADS_LIMIT,
          },
        })
        .then(({ data, error }) => {
          if (error) handleError(error.value, 'Failed to fetch threads');
          if (data) {
            setThreads(data.data);
            setTotalPages(Math.max(1, Math.ceil(data.total / THREADS_LIMIT)));
          }
          setLoadingThreads(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [
    kindFilters,
    projectFilters,
    statusFilters,
    search,
    page,
    refreshKey,
    handleError,
  ]);

  // Fetch projects once on mount for the filter dropdown.
  useEffect(() => {
    api.threads.projects.get().then(({ data }) => {
      if (data) setProjects(data);
    });
  }, []);

  // WS: refresh the thread list on every server push.
  useEffect(() => {
    const socket = ws.subscribe();
    socket.on('error', (e) => console.error('[ws] error', e));
    socket.subscribe(({ data }) => {
      if (data.type !== 'thread:upserted') return;
      setRefreshKey((k) => k + 1); // Deliberately silent — no setLoadingThreads, unlike the user-driven filter/page changes above.
    });
    return () => {
      socket.close();
    };
  }, []);

  const handleSelectThread = (id: string, e: React.MouseEvent) => {
    const link = `/threads/${id}`;

    if (e.button === 1) window.open(link, '_blank', 'noopener,noreferrer');
    else navigate(link);
  };

  const handleDeleteThread = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const { id } = e.currentTarget.dataset;
    const thread = threads.find((t) => t.id === id);
    if (!thread) return;
    deleteThread.request(async () => {
      const { error } = await api.threads({ id: thread.id }).delete();
      if (error) {
        handleError(error.value, 'Failed to delete thread');
        return;
      }
      setThreads((prev) => prev.filter(({ id }) => id !== thread.id));
    }, thread);
  };

  const renderTitle = (thread: Thread) => (
    <Text size="sm" fw={500} className="thread-title-text">
      {thread.title}
    </Text>
  );

  const renderBadge = (thread: Thread) => {
    const s = thread.latest_run_status;
    if (!s) return null;
    return (
      <Badge
        color={RUN_STATUS_COLOR[s]}
        size="sm"
        tt="capitalize"
        className="thread-badge"
      >
        {s}
      </Badge>
    );
  };

  const renderRunStats = (thread: Thread) => {
    const { run_count: total, failure_count: failed } = thread;
    if (total === 0) return null;
    return (
      <Text size="xs" c={failed > 0 ? 'orange' : 'dimmed'}>
        {total}
        {failed > 0 && ` (${failed} failed)`}
      </Text>
    );
  };

  const renderDeleteBtn = (thread: Thread) =>
    user?.role === Role.Admin && (
      <ActionIcon
        variant="subtle"
        color="red"
        className="thread-delete-btn"
        data-id={thread.id}
        onClick={handleDeleteThread}
      >
        <Icon as={IconTrash} />
      </ActionIcon>
    );

  const getDuration = (thread: Thread): string | null => {
    if (!thread.latest_run_started_at) return null;
    if (
      thread.latest_run_status !== 'completed' &&
      thread.latest_run_status !== 'failed'
    )
      return null;
    if (thread.latest_run_completed_at) {
      return formatDuration(
        +new Date(thread.latest_run_completed_at) -
          +new Date(thread.latest_run_started_at),
      );
    }
    return formatDuration(
      +new Date(thread.updated_at) - +new Date(thread.latest_run_started_at),
    );
  };

  const renderDuration = (thread: Thread) => {
    if (
      thread.latest_run_status === 'running' &&
      thread.latest_run_started_at
    ) {
      return <Counter mode="up" startedAt={thread.latest_run_started_at} />;
    }
    return getDuration(thread);
  };

  const hasFilters =
    statusFilters.length > 0 ||
    projectFilters.length > 0 ||
    kindFilters.length > 0 ||
    !!search;

  const clearFilters = () => {
    setStatusFilters([]);
    setProjectFilters([]);
    setKindFilters([]);
    setSearch('');
    setPage(1);
    setLoadingThreads(true);
  };

  return (
    <Stack className="threads-page" gap="md">
      <Title order={2} visibleFrom="sm">
        Threads
      </Title>

      <Group gap="sm" wrap="wrap" data-tour="threads-list">
        <TextInput
          className="thread-filter"
          placeholder="Search by title"
          leftSection={<Icon as={IconSearch} />}
          value={search}
          onChange={(e) => filterSearch(e.currentTarget.value)}
          size="sm"
        />
        <MultiSelect
          className="thread-filter"
          placeholder={statusFilters.length > 0 ? '' : 'Status'}
          data={[
            { value: 'running', label: 'Running' },
            { value: 'queued', label: 'Queued' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
          ]}
          value={statusFilters}
          onChange={filterStatuses}
          renderOption={({ option, checked }) => (
            <Group gap="sm" wrap="nowrap">
              <Checkbox
                checked={checked}
                onChange={() => {}}
                size="xs"
                tabIndex={-1}
                className="thread-filter-checkbox"
              />
              <Text size="sm">{option.label}</Text>
            </Group>
          )}
          searchable
          clearable
          size="sm"
        />
        <MultiSelect
          className="thread-filter"
          placeholder={kindFilters.length > 0 ? '' : 'Type'}
          data={[
            { value: 'mr_review', label: 'MR Review' },
            { value: 'work_item_resolve', label: 'Work Item Resolve' },
            { value: 'task_resolve', label: 'Task Resolve' },
          ]}
          value={kindFilters}
          onChange={filterKinds}
          renderOption={({ option, checked }) => (
            <Group gap="sm" wrap="nowrap">
              <Checkbox
                checked={checked}
                onChange={() => {}}
                size="xs"
                tabIndex={-1}
                className="thread-filter-checkbox"
              />
              <Text size="sm">{option.label}</Text>
            </Group>
          )}
          searchable
          clearable
          size="sm"
        />
        {projects.length > 0 && (
          <MultiSelect
            className="thread-filter"
            placeholder={projectFilters.length > 0 ? '' : 'Project'}
            data={projects}
            value={projectFilters}
            onChange={filterProjects}
            renderOption={({ option, checked }) => (
              <Group gap="sm" wrap="nowrap" align="start">
                <Checkbox
                  checked={checked}
                  onChange={() => {}}
                  size="xs"
                  tabIndex={-1}
                  className="thread-filter-checkbox"
                />
                <Text size="sm" className="thread-filter-text">
                  {option.label}
                </Text>
              </Group>
            )}
            searchable
            clearable
            size="sm"
          />
        )}
      </Group>

      <Divider />

      {loadingThreads ? (
        <Stack gap="xs">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={52} radius="sm" />
          ))}
        </Stack>
      ) : !threads.length ? (
        <Center className="thread-empty">
          {!hasFilters ? (
            <EmptyState
              icon={<Icon as={IconStack2} size={40} />}
              title="No threads yet"
              description="Threads appear here when a merge request is processed."
              size="md"
            />
          ) : (
            <EmptyState
              icon={<Icon as={IconSearch} size={40} />}
              title="No threads match your filters"
              description="Try adjusting or clearing your filters."
              size="md"
            >
              <EmptyState.Actions>
                <Button variant="default" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              </EmptyState.Actions>
            </EmptyState>
          )}
        </Center>
      ) : (
        <ScrollArea
          className="thread-list-scrollarea"
          type="hover"
          offsetScrollbars="present"
        >
          {isMobile ? (
            <Stack gap="xs">
              {threads.map((thread) => {
                const dur = renderDuration(thread);
                const upd = formatDate(thread.updated_at);

                return (
                  <Card
                    key={thread.id}
                    component={Link}
                    to={`/threads/${thread.id}`}
                    withBorder
                    radius="md"
                    padding="sm"
                    className="thread-card"
                  >
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Box className="thread-title-box">
                        {renderTitle(thread)}
                      </Box>
                      <Group
                        gap="xs"
                        wrap="nowrap"
                        className="thread-actions-group"
                      >
                        {renderBadge(thread)}
                        {renderDeleteBtn(thread)}
                      </Group>
                    </Group>
                    {(dur || upd || thread.run_count > 0) && (
                      <Group gap="xs" mt={4}>
                        {renderRunStats(thread)}
                        {dur && (
                          <Text size="xs" c="dimmed">
                            {dur}
                          </Text>
                        )}
                        {upd && (
                          <Tooltip label={upd.full}>
                            <Text size="xs" c="dimmed">
                              {upd.display}
                            </Text>
                          </Tooltip>
                        )}
                      </Group>
                    )}
                  </Card>
                );
              })}
            </Stack>
          ) : (
            <Table
              highlightOnHover
              highlightOnHoverColor="var(--mantine-color-dark-6)"
              layout="fixed"
              withRowBorders={false}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Title</Table.Th>
                  <Table.Th className="thread-col-status">Status</Table.Th>
                  <Table.Th className="thread-col-runs">Runs</Table.Th>
                  <Table.Th className="thread-col-duration">Duration</Table.Th>
                  <Table.Th className="thread-col-updated">Updated</Table.Th>
                  <Table.Th className="thread-col-delete" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {threads.map((thread) => {
                  const dur = renderDuration(thread);
                  const upd = formatDate(thread.updated_at);

                  return (
                    <Table.Tr
                      key={thread.id}
                      className="thread-row"
                      onClick={(e) => handleSelectThread(thread.id, e)}
                      onAuxClick={(e) => handleSelectThread(thread.id, e)}
                    >
                      <Table.Td>{renderTitle(thread)}</Table.Td>
                      <Table.Td>{renderBadge(thread)}</Table.Td>
                      <Table.Td>{renderRunStats(thread)}</Table.Td>
                      <Table.Td>
                        {dur && (
                          <Text size="xs" c="dimmed">
                            {dur}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {upd && (
                          <Tooltip label={upd.full}>
                            <Text size="xs" c="dimmed">
                              {upd.display}
                            </Text>
                          </Tooltip>
                        )}
                      </Table.Td>
                      <Table.Td>{renderDeleteBtn(thread)}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      )}

      {totalPages > 1 && (
        <Group justify="center" mt="sm">
          <Button
            variant="transparent"
            size="compact-xs"
            disabled={page === 1}
            onClick={() => {
              setPage(page - 1);
              setLoadingThreads(true);
            }}
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
            onClick={() => {
              setPage(page + 1);
              setLoadingThreads(true);
            }}
          >
            Next
          </Button>
        </Group>
      )}

      {deleteThread.modal}
    </Stack>
  );
};

export default ThreadsPage;
