import { useState } from 'react';
import {
  Card,
  Divider,
  Flex,
  Group,
  Indicator,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconCircleCheckFilled,
  IconListCheck,
} from '@tabler/icons-react';

import type { Todo } from '@/types';

import Icon from '@/components/icon';

interface ITodoListProps {
  todos: Todo[];
}

const TodoList = ({ todos }: ITodoListProps) => {
  const [collapsed, setCollapsed] = useState(true);

  if (!todos.length) return null;

  const doneCount = todos.filter((t) => t.status === 'completed').length;

  return (
    <Card
      className="todo-list"
      radius="md"
      pb={collapsed ? undefined : 0}
      data-tour="thread-todos"
    >
      <Card.Section
        className="todo-list__header"
        p="xs"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <Group justify="space-between">
          <Group gap={6}>
            <Icon as={IconListCheck} size={12} />
            <Text size="xs">Todos</Text>
            <Text component="span" size="xs" c="dimmed">
              ({doneCount}/{todos.length})
            </Text>
          </Group>
          <Group gap={4}>
            {doneCount === todos.length && (
              <Icon
                as={IconCircleCheckFilled}
                color="var(--mantine-color-green-filled)"
              />
            )}
            <Icon as={collapsed ? IconChevronRight : IconChevronDown} />
          </Group>
        </Group>
      </Card.Section>
      {!collapsed && (
        <>
          <Divider />
          <Card.Section p="xs">
            <ScrollArea.Autosize
              mah="120px"
              type="hover"
              offsetScrollbars="present"
            >
              <Stack gap="xs">
                {todos.map((todo, i) => (
                  <Group
                    key={`${i}-${todo.content}`}
                    className="todo-item"
                    data-status={todo.status}
                    gap="xs"
                    wrap="nowrap"
                    align="start"
                  >
                    <Flex align="center">
                      {todo.status === 'in_progress' ? (
                        <Indicator
                          className="todo-item__dot"
                          variant="dot"
                          size={6}
                        />
                      ) : (
                        <Icon
                          as={
                            todo.status === 'pending' ? IconCircle : IconCheck
                          }
                          color={
                            todo.status === 'completed' ? 'green' : undefined
                          }
                        />
                      )}
                    </Flex>
                    <Text className="todo-item__content" size="xs">
                      {todo.content}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Card.Section>
        </>
      )}
    </Card>
  );
};

export default TodoList;
