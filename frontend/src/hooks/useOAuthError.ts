import { use, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Context } from '@/contexts';

export const useOAuthError = (fallbackMessage: string) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { handleError } = use(Context);

  useEffect(() => {
    const error = searchParams.get('error');
    if (!error) return;

    handleError(searchParams.get('error_description') || fallbackMessage);
    setSearchParams(
      (prev) => {
        prev.delete('error');
        prev.delete('error_description');
        return prev;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, handleError, fallbackMessage]);
};
