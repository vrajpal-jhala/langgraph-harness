import { createContext } from 'react';

import { authClient } from '@/api';

export type AuthUser = typeof authClient.$Infer.Session | null;

export const AuthContext = createContext<{
  user: AuthUser;
  loading: boolean;
  checkFailed: boolean;
  retry: () => void;
}>({ user: null, loading: true, checkFailed: false, retry: () => {} });

export const Context = createContext({
  // eslint-disable-next-line
  handleError: (_error: unknown, _fallbackMessage?: string) => {},
});
