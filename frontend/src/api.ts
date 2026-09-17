// Generated from the backend via `npm run gen:types` (backend/dts-bundle.config.cjs).
// Decouples this build from the backend source.
import { treaty } from '@elysiajs/eden';
import { createAuthClient } from 'better-auth/client';
import { customSessionClient } from 'better-auth/client/plugins';

import type { App, Auth } from './__generated__/app';
import { config } from './config';

// Cookies ride along automatically only for same-origin requests — use 'include' otherwise
const client = treaty<App>(config.apiUrl, {
  fetch: { credentials: 'include' },
});
export const api = client.api;
export const ws = client.ws;

// better-auth's built-in routes aren't Elysia routes, so Eden can't type them.
export const authClient = createAuthClient({
  baseURL: `${config.apiUrl}/auth`,
  plugins: [customSessionClient<Auth>()],
});
