import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

type ConfirmActionConfig<T> = {
  title: string;
  message: ReactNode | ((target: T | undefined) => ReactNode);
  confirmLabel: string;
  destructive?: boolean;
};

// The action owns error reporting — the modal closes regardless of outcome.
export const useConfirmAction = <T = undefined,>(
  config: ConfirmActionConfig<T>,
) => {
  const [opened, { open, close }] = useDisclosure(false);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<T | undefined>(undefined);
  const actionRef = useRef<(() => Promise<void>) | null>(null);

  const request = (action: () => Promise<void>, meta?: T) => {
    actionRef.current = action;
    setTarget(meta);
    open();
  };

  const confirm = async () => {
    if (!actionRef.current) return;
    setLoading(true);
    await actionRef.current();
    setLoading(false);
    close();
  };

  const message =
    typeof config.message === 'function'
      ? (config.message as (target: T | undefined) => ReactNode)(target)
      : config.message;

  const modal = (
    <Modal opened={opened} onClose={close} title={config.title} centered>
      <Stack gap="md">
        <Text size="sm">{message}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button
            color={config.destructive ? 'red' : undefined}
            loading={loading}
            onClick={confirm}
          >
            {config.confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  return { request, modal };
};
