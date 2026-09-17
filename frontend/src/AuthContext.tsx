import { use, useCallback, useEffect, useState } from 'react';

import { authClient } from '@/api';
import { AuthContext, type AuthUser, Context } from '@/contexts';

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState(true);
  const [checkFailed, setCheckFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { handleError } = use(Context);

  useEffect(() => {
    authClient
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          handleError(error, 'Failed to check sign-in status');
          setCheckFailed(true);
        } else {
          setUser(data);
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
    <AuthContext value={{ user, loading, checkFailed, retry }}>
      {children}
    </AuthContext>
  );
};

export { AuthProvider };
