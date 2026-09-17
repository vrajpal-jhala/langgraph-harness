import { useCallback } from 'react';
import { notifications } from '@mantine/notifications';

import { Context } from '@/contexts';

const ContextProvider = ({ children }: { children: React.ReactNode }) => {
  const handleError = useCallback(
    (error: unknown, fallbackMessage: string = 'An unknown error occurred') => {
      const message =
        typeof error === 'string'
          ? error
          : (error as { message: string })?.message || '';

      notifications.show({
        message: message || fallbackMessage,
        color: 'red',
        autoClose: 3000,
      });
    },
    [],
  );

  return <Context value={{ handleError }}>{children}</Context>;
};

export { ContextProvider };
