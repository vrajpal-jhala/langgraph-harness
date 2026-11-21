import { use, useCallback, useEffect, useState } from 'react';

import { api, authClient } from '@/api';
import {
  AuthContext,
  type AuthUser,
  Context,
  type Providers,
} from '@/contexts';

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser>(null);
  const [providers, setProviders] = useState<Providers>({
    gitlab: false,
    github: false,
  });
  const [loading, setLoading] = useState(true);
  const [checkFailed, setCheckFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { handleError } = use(Context);

  useEffect(() => {
    Promise.all([authClient.getSession(), api.providers.get()])
      .then(([session, providersResponse]) => {
        const error = session.error ?? providersResponse.error;
        if (error || !providersResponse.data) {
          handleError(error, 'Failed to check sign-in status');
          setCheckFailed(true);
        } else {
          setUser(session.data);
          setProviders(providersResponse.data);
        }
      })
      .catch((error) => {
        handleError(error, 'Failed to check sign-in status');
        setCheckFailed(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [handleError, attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setCheckFailed(false);
    setAttempt((a) => a + 1);
  }, []);

  return (
    <AuthContext value={{ user, providers, loading, checkFailed, retry }}>
      {children}
    </AuthContext>
  );
};

export { AuthProvider };
