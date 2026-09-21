import { use, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Divider,
  EmptyState,
  Group,
  MultiSelect,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconBrain,
  IconCheck,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';

import {
  type Memory,
  MEMORY_CATEGORIES,
  type MemoryCategory,
  MemoryScope,
  Role,
} from '@/types';

import Icon from '@/components/icon';
import { Markdown } from '@/components/markdown';

import { api } from '@/api';
import { Context } from '@/contexts';
import { useAuth } from '@/hooks/useAuth';
import { useConfirmAction } from '@/hooks/useConfirmAction';
import { formatDate } from '@/utils';

const CATEGORY_LABEL: Record<string, string> = {
  knowledge: 'Knowledge',
  preference: 'Preference',
  lesson: 'Lesson',
  decision: 'Decision',
};

const SOURCE_WORKFLOWS = ['code-review', 'work-item-resolve', 'chat'] as const;

const SOURCE_LABEL: Record<string, string> = {
  'code-review': 'MR Review',
  'work-item-resolve': 'Work Item Resolve',
  chat: 'Chat',
};

function entryContentMarkdown(entry: Memory): string {
  const evidence = entry.evidence.length
    ? `\n\n${entry.evidence.map((e) => `> ${e}`).join('\n>\n')}`
    : '';
  return `### ${entry.title}\n\n${entry.content}${evidence}`;
}

function entryFooterText(entry: Memory): string {
  const updated = formatDate(entry.updated_at);
  const updatedText = `Updated ${updated?.display ?? entry.updated_at}`;
  switch (entry.source.workflow) {
    case 'chat':
      return `${updatedText} · from chat`;
    case 'code-review':
      return `${updatedText} · MR !${entry.source.mrIid}`;
    case 'work-item-resolve':
      return `${updatedText} · issue #${entry.source.issueIid}`;
  }
}

const MemoriesPage = () => {
  const { handleError } = use(Context);
  const { user } = useAuth();
  const deleteMemory = useConfirmAction<{
    id: string;
    category: MemoryCategory;
    title: string;
  }>({
    title: 'Delete memory',
    message: (target) => `Delete "${target?.title}"? This can't be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>(
    {},
  );
  const [personalCount, setPersonalCount] = useState(0);
  const [categoryFilters, setCategoryFilters] = useState<MemoryCategory[]>([]);
  const [sourceFilters, setSourceFilters] = useState<string[]>([]);
  const [memories, setMemories] = useState<Record<string, Memory[]> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [loadedSelected, setLoadedSelected] = useState(selected);
  const [loadedCategoryFilters, setLoadedCategoryFilters] =
    useState(categoryFilters);

  // Flips loading during render, before paint, so a filter/selection change never flashes stale "loaded" content.
  if (
    selected !== loadedSelected ||
    categoryFilters !== loadedCategoryFilters
  ) {
    setLoadedSelected(selected);
    setLoadedCategoryFilters(categoryFilters);
    if (selected) setLoading(true);
  }

  useEffect(() => {
    api.threads.projects.get().then(({ data, error }) => {
      if (error) handleError(error.value, 'Failed to fetch projects');
      if (data) setProjects(data);
    });
    api.memories.projects.get().then(({ data, error }) => {
      if (error)
        handleError(error.value, 'Failed to fetch project memory counts');
      if (data) setProjectCounts(data);
    });
    api.memories.personal.get().then(({ data, error }) => {
      if (error)
        handleError(error.value, 'Failed to fetch personal memory count');
      if (data) setPersonalCount(data);
    });
  }, [handleError]);

  const counts = useMemo(
    (): Record<string, number> => ({
      ...projectCounts,
      [MemoryScope.Personal]: personalCount,
    }),
    [projectCounts, personalCount],
  );

  // Projects surface which ones actually have memories up front, instead of making the user pick each one to find out.
  const options = useMemo(
    () => [
      // Personal pinned first
      { value: MemoryScope.Personal, label: 'Personal' },
      ...[...projects]
        .sort((a, b) => {
          const diff = (projectCounts[b] ?? 0) - (projectCounts[a] ?? 0);
          return diff !== 0 ? diff : a.localeCompare(b);
        })
        .map((project) => ({ value: project, label: project })),
    ],
    [projects, projectCounts],
  );

  useEffect(() => {
    if (!selected) return;

    api.memories
      .get({
        query: {
          ...(selected === MemoryScope.Personal
            ? { scope: MemoryScope.Personal }
            : { projectId: selected }),
          categories: categoryFilters.length ? categoryFilters : undefined,
        },
      })
      .then(({ data, error }) => {
        if (error) handleError(error.value, 'Failed to fetch memories');
        if (data) setMemories(data);
        setLoading(false);
      });
  }, [selected, categoryFilters, handleError]);

  const handleDeleteMemory = (entry: Memory, category: MemoryCategory) => {
    deleteMemory.request(
      async () => {
        const { error } = await api.memories({ id: entry.id }).delete();

        if (error) {
          handleError(error.value, 'Failed to delete memory');
          return;
        }
        setMemories((prev) =>
          prev
            ? {
                ...prev,
                [category]: prev[category].filter((e) => e.id !== entry.id),
              }
            : prev,
        );
      },
      { id: entry.id, category, title: entry.title },
    );
  };

  // Personal memories are always and only chat-sourced, project memories never are — so the effective source is scope-determined, not user-chosen, at either end.
  const effectiveSourceFilters = useMemo(
    () =>
      selected === MemoryScope.Personal
        ? ['chat']
        : sourceFilters.filter((workflow) => workflow !== 'chat'),
    [selected, sourceFilters],
  );
  const sourceFilterActive = effectiveSourceFilters.length > 0;
  // Distinct from sourceFilterActive: Personal always forces 'chat' in, which is a no-op filter (every personal memory is chat-sourced), not a real user-chosen restriction.
  const hasUserSourceFilter =
    selected !== MemoryScope.Personal && sourceFilters.length > 0;

  const filteredMemories = useMemo(() => {
    if (!memories || !sourceFilterActive) return memories;
    return Object.fromEntries(
      MEMORY_CATEGORIES.map((category) => [
        category,
        (memories[category] ?? []).filter((entry) =>
          effectiveSourceFilters.includes(entry.source.workflow),
        ),
      ]),
    );
  }, [memories, sourceFilterActive, effectiveSourceFilters]);

  const categoriesWithEntries = filteredMemories
    ? MEMORY_CATEGORIES.filter((category) => filteredMemories[category]?.length)
    : [];
  const hasActiveFilters = categoryFilters.length > 0 || hasUserSourceFilter;

  return (
    <Stack className="memories-page" gap="md">
      <Title order={2} visibleFrom="sm">
        Memories
      </Title>

      <Group gap="sm" wrap="wrap" data-tour="memories-filters">
        <Select
          className="memories-filter"
          placeholder="Select memories to view"
          data={options}
          value={selected}
          onChange={setSelected}
          renderOption={({ option, checked }) => {
            const count = counts[option.value] ?? 0;

            return (
              <Group gap="xs" justify="space-between" wrap="nowrap" flex={1}>
                <Group gap="xs" wrap="nowrap">
                  <Box w={16} h={16}>
                    {checked && <Icon as={IconCheck} size={16} />}
                  </Box>
                  <Text size="sm" className="memories-filter-text">
                    {option.label}
                  </Text>
                </Group>
                {count ? (
                  <Badge size="xs" flex="0 0 auto">
                    {count}
                  </Badge>
                ) : (
                  <div />
                )}
              </Group>
            );
          }}
          searchable
          clearable
          size="sm"
        />
        <MultiSelect
          className="memories-filter"
          placeholder={categoryFilters.length ? '' : 'All categories'}
          data={MEMORY_CATEGORIES.map((category) => ({
            value: category,
            label: CATEGORY_LABEL[category] ?? category,
          }))}
          value={categoryFilters}
          onChange={setCategoryFilters}
          disabled={!selected}
          renderOption={({ option, checked }) => (
            <Group gap="sm" wrap="nowrap">
              <Checkbox
                checked={checked}
                onChange={() => {}}
                size="xs"
                tabIndex={-1}
                className="memories-category-checkbox"
              />
              <Text size="sm">{option.label}</Text>
            </Group>
          )}
          searchable
          clearable
          size="sm"
        />
        <MultiSelect
          className="memories-filter"
          placeholder={effectiveSourceFilters.length ? '' : 'All sources'}
          data={SOURCE_WORKFLOWS.map((workflow) => ({
            value: workflow,
            label: SOURCE_LABEL[workflow] ?? workflow,
            disabled: workflow === 'chat' || selected === MemoryScope.Personal,
          }))}
          value={effectiveSourceFilters}
          onChange={setSourceFilters}
          disabled={!selected}
          renderOption={({ option, checked }) => (
            <Group gap="sm" wrap="nowrap">
              <Checkbox
                checked={checked}
                onChange={() => {}}
                size="xs"
                tabIndex={-1}
                className="memories-category-checkbox"
              />
              <Text size="sm">{option.label}</Text>
            </Group>
          )}
          searchable
          clearable={selected !== MemoryScope.Personal}
          size="sm"
        />
      </Group>

      <Divider />

      {!selected ? (
        <Center className="memories-empty">
          <EmptyState
            icon={<Icon as={IconBrain} size={40} />}
            title="Pick something to view"
            description="Select a project or Personal above to see its memories."
            size="md"
          />
        </Center>
      ) : loading ? (
        <Stack gap="xs">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={80} radius="sm" />
          ))}
        </Stack>
      ) : !categoriesWithEntries.length ? (
        <Center className="memories-empty">
          {!hasActiveFilters ? (
            <EmptyState
              icon={<Icon as={IconBrain} size={40} />}
              title="No memories yet"
              description={
                selected === MemoryScope.Personal
                  ? "The agent hasn't saved any personal memories from your chats yet."
                  : "This project hasn't accumulated any durable memories from reviews yet."
              }
              size="md"
            />
          ) : (
            <EmptyState
              icon={<Icon as={IconSearch} size={40} />}
              title="No memories match your filters"
              description="Try a different category or source."
              size="md"
            >
              <EmptyState.Actions>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setCategoryFilters([]);
                    setSourceFilters([]);
                  }}
                >
                  Clear filters
                </Button>
              </EmptyState.Actions>
            </EmptyState>
          )}
        </Center>
      ) : (
        <Stack gap="lg" className="memories-categories">
          {categoriesWithEntries.map((category) => (
            <Stack key={category} gap="xs" className="memories-category">
              <Group gap="xs">
                <Text fw={600} size="sm">
                  {CATEGORY_LABEL[category] ?? category}
                </Text>
                <Badge size="sm">{filteredMemories![category].length}</Badge>
              </Group>
              {filteredMemories![category].map((entry, i) => (
                <div key={entry.id}>
                  {i > 0 && <Divider mb="xs" />}
                  <div className="memories-entry-content">
                    <Markdown content={entryContentMarkdown(entry)} />
                  </div>
                  <Group justify="space-between" wrap="nowrap" gap="xs" mt="xs">
                    <Text size="xs" c="dimmed" fs="italic">
                      {entryFooterText(entry)}
                    </Text>
                    {(user?.role === Role.Admin ||
                      (selected === MemoryScope.Personal &&
                        entry.user_id === user?.id)) && (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        className="memories-delete-btn"
                        onClick={() => handleDeleteMemory(entry, category)}
                      >
                        <Icon as={IconTrash} />
                      </ActionIcon>
                    )}
                  </Group>
                </div>
              ))}
            </Stack>
          ))}
        </Stack>
      )}
      {deleteMemory.modal}
    </Stack>
  );
};

export default MemoriesPage;
