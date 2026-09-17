import { use } from 'react';

import { AuthContext } from '@/contexts';

export const useAuth = () => use(AuthContext);
