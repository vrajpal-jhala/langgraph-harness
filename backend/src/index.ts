import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';

import { nodeAdapter } from './adapter.js';
import { auth } from './components/auth/index.js';
import { api } from './components/index.js';
import { repositoriesManager } from './components/repositories/manager.js';
import { runsService } from './components/runs/service.js';
import { webhook } from './components/webhooks/index.js';
import {
  mrReviewQueue,
  mrReviewWorker,
} from './components/workflows/mr-review/queue.js';
import { workflows } from './components/workflows/service.js';
import {
  workItemResolveQueue,
  workItemResolveWorker,
} from './components/workflows/work-item-resolve/queue.js';
import { ws } from './components/ws/index.js';
import { pool } from './utils/db.js';
import { AppError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { services } from './utils/services.js';

const PORT = process.env.SERVER_PORT;

await services.init();

export const app = new Elysia({ adapter: nodeAdapter })
  .use(cors())
  .get('/health', () => ({ status: 'ok' }))
  .error({ AppError })
  .onError((ctx) => {
    const { code, error } = ctx;

    logger.error(
      {
        err: ctx.error,
        request: {
          method: ctx.request.method,
          url: ctx.request.url,
          path: ctx.path,
          headers: Object.fromEntries(ctx.request.headers.entries()),
          params: ctx.params,
          query: ctx.query,
          body: ctx.body,
        },
        response: {
          status: ctx.set.status,
        },
      },
      'Request failed',
    );

    if (code === 'AppError') return error.toResponse();
  })
  .use(api)
  .use(webhook)
  .use(ws)
  .mount(auth.handler)
  .listen(PORT, () => {
    console.log(`Elysia running at http://localhost:${PORT}`);
  });

const shutdown = async () => {
  // Abort active runs first so the worker exits promptly instead of waiting minutes for in-flight reviews.
  runsService.abortAll();
  await Promise.allSettled([
    ...workflows.map((workflow) => workflow.cleanup()),
    repositoriesManager.cleanup(),
    mrReviewWorker?.close(),
    mrReviewQueue?.close(),
    workItemResolveWorker?.close(),
    workItemResolveQueue?.close(),
    pool.end(),
  ]);
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export type App = typeof app;
export type Auth = typeof auth;
