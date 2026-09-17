import { t } from 'elysia';

export const setOpenRouterKeySchema = t.Object({
  apiKey: t.String({ minLength: 1 }),
});
