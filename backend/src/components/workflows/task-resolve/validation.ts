import { t } from 'elysia';

const repoUrlSchema = t.String({ minLength: 1, maxLength: 2048 });

export const createTaskSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 200 }),
  repoUrl: repoUrlSchema,
  prompt: t.String({ minLength: 1, maxLength: 20_000 }),
});
