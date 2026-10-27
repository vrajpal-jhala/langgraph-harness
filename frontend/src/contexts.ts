import { createContext } from 'react';

import { authClient } from '@/api';

export type AuthUser = typeof authClient.$Infer.Session | null;

export type Providers = { gitlab: boolean; github: boolean };

export const AuthContext = createContext<{
  user: AuthUser;
  providers: Providers;
  loading: boolean;
  checkFailed: boolean;
  retry: () => void;
}>({
  user: null,
  providers: { gitlab: false, github: false },
  loading: true,
  checkFailed: false,
  retry: () => {},
});

export const Context = createContext({
  // eslint-disable-next-line
  handleError: (_error: unknown, _fallbackMessage?: string) => {},
});
