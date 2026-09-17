import { Elysia, sse } from 'elysia';

import type { TaskResolveRunInput } from '#types.js';
import { MemoryScope, RunKind, RunStatus } from '#types.js';

import { analyticsService } from './analytics/service.js';
import {
  analyticsByRepoQuerySchema,
  analyticsOverviewQuerySchema,
  analyticsTrendQuerySchema,
} from './analytics/validation.js';
import { authService } from './auth/service.js';
import { memoriesService } from './memories/service.js';
import { listMemoriesQuerySchema } from './memories/validation.js';
import { monitoringService } from './monitoring/service.js';
import { runsService } from './runs/service.js';
import {
  decideRunSchema,
  queueStatusQuerySchema,
  retryRunSchema,
} from './runs/validation.js';
import { schedulesService } from './schedules/service.js';
import {
  createScheduleSchema,
  updateScheduleSchema,
} from './schedules/validation.js';
import { settingsService } from './settings/service.js';
import { setOpenRouterKeySchema } from './settings/validation.js';
import { threadsDal } from './threads/dal.js';
import { threadsService } from './threads/service.js';
import {
  createThreadSchema,
  listThreadsQuerySchema,
  updateThreadSchema,
} from './threads/validation.js';
import { uploads } from './uploads/index.js';
import { sendChatMessageSchema } from './workflows/chat/validation.js';
import { getStatus as getMrReviewQueueStatus } from './workflows/mr-review/queue.js';
import { workflowsService } from './workflows/service.js';
import {
  enqueueTaskResolve,
  getStatus as getTaskResolveQueueStatus,
} from './workflows/task-resolve/queue.js';
import { createTaskSchema } from './workflows/task-resolve/validation.js';
import { getStatus as getWorkItemResolveQueueStatus } from './workflows/work-item-resolve/queue.js';

import { authMacro, isAdmin } from '#utils/auth.js';
import { llms } from '#utils/config.js';
import { errors } from '#utils/errors.js';
import { resolveProjectFromUrl } from '#utils/gitlab.js';
import { parseHarnessYml } from '#utils/harness-config.js';

// inline routes to auto infer response type
export const api = new Elysia({ prefix: '/api' })
  .use(authMacro)
  .guard({ auth: true }, (app) =>
    app
      .use(uploads)
      .group('/threads', (app) =>
        app
          .get(
            '/',
            ({ query, session }) =>
              threadsService.list({
                kinds: query.kinds,
                projects: query.projects,
                statuses: query.statuses,
                title: query.title ? { pattern: query.title } : undefined,
                userId: session.id,
                limit: query.limit ?? 25,
                offset: query.offset ?? 0,
              }),
            { query: listThreadsQuerySchema },
          )
          .get('/projects', () => threadsService.listProjects())
          .post(
            '/',
            async ({ body, session, set }) => {
              set.status = 201;
              return threadsService.create(body.title, body.kind, session.id);
            },
            { body: createThreadSchema },
          ),
      )
      .group('/threads/:id', (app) =>
        app
          .onBeforeHandle(({ params, session }) =>
            threadsService.assertAccess(params.id, session),
          )
          .get('/', ({ params }) => threadsService.getById(params.id))
          .patch(
            '/',
            ({ body, params }) => threadsService.update(params.id, body.title),
            { body: updateThreadSchema },
          )
          .delete('/', async ({ params, session, set }) => {
            await threadsService.assertCanMutate(params.id, session);
            await threadsService.delete(params.id);
            set.status = 204;
          }),
      )
      .group('/threads/:id/runs', (app) =>
        app
          .onBeforeHandle(({ params, session }) =>
            threadsService.assertAccess(params.id, session),
          )
          .get('/', ({ params }) => runsService.list(params.id))
          .get('/:runId', ({ params }) =>
            runsService.getById(params.runId, params.id),
          )
          .get('/:runId/stream', async function* ({ params }) {
            const { runId } = params;
            for await (const event of runsService.stream(runId)) {
              yield sse(event);
            }
            const run = await runsService.getById(runId, params.id);
            yield sse({
              event: 'run_end',
              data: {
                status:
                  (await runsService.getStatus(runId)) ?? RunStatus.COMPLETED,
                error: await runsService.getError(runId),
                started_at: run.started_at,
                completed_at: run.completed_at,
                updated_at: run.updated_at,
              },
            });
          })
          .post(
            '/',
            async ({ params, body, session, set }) => {
              const thread = await threadsService.getById(params.id);
              const workflow = workflowsService.forKind(thread.kind);
              if (workflow.startMode !== 'immediate' || !workflow.buildInput) {
                throw errors.runs.notImmediate();
              }

              const input = await workflow.buildInput(params.id, body);
              const run = await runsService.create(
                params.id,
                workflow.kind,
                input,
                session,
              );
              void runsService.start(
                params.id,
                run.id,
                workflow.kind,
                input,
                session,
              );

              set.status = 201;
              return run;
            },
            { body: sendChatMessageSchema },
          )
          .post(
            '/:runId/retry',
            async ({ params, body, session, set }) => {
              await threadsService.assertCanMutate(params.id, session);
              set.status = 201;
              return runsService.retry(
                params.id,
                params.runId,
                body.checkpointId,
                session,
              );
            },
            { body: retryRunSchema },
          )
          .post(
            '/:runId/decision',
            // No assertCanMutate — decision-resume only exists on chat threads, and assertAccess already restricts those to their owner.
            async ({ params, body, session, set }) => {
              set.status = 201;
              return runsService.decide(
                params.id,
                params.runId,
                body.toolCallId,
                body.decision,
                session,
              );
            },
            { body: decideRunSchema },
          )
          .post('/:runId/abort', async ({ params, session, set }) => {
            await threadsService.assertCanMutate(params.id, session);
            await runsService.requestAbort(params.id, params.runId);
            set.status = 204;
          }),
      )
      .group('/workflows', (app) =>
        app
          .get('/', () => workflowsService.list())
          .get('/:id', ({ params }) => workflowsService.getById(params.id))
          .get('/:id/graph', ({ params }) =>
            workflowsService.getGraph(params.id),
          ),
      )
      .group('/task-resolve', (app) =>
        app
          .onBeforeHandle(({ session }) => {
            if (!isAdmin(session.username)) throw errors.runs.forbidden();
          })
          .post(
            '/',
            async ({ body, session, set }) => {
              const { projectPath, defaultBranch } =
                await resolveProjectFromUrl(body.repoUrl);

              const thread = await threadsService.create(
                body.title,
                RunKind.TaskResolve,
                session.id,
              );
              await threadsDal.mergeMetadata(thread.id, {
                project: projectPath,
              });

              const input: TaskResolveRunInput = {
                kind: RunKind.TaskResolve,
                title: body.title,
                projectPath,
                prompt: body.prompt,
                defaultBranch,
                submittedBy: session.username,
                model: llms.find((m) => m.isDefault)?.model ?? llms[0].model,
                config: await parseHarnessYml(projectPath),
              };

              const run = await runsService.create(
                thread.id,
                RunKind.TaskResolve,
                input,
                session,
              );
              await enqueueTaskResolve({
                threadId: thread.id,
                runId: run.id,
                ...input,
              });

              set.status = 201;
              return { thread, run };
            },
            { body: createTaskSchema },
          ),
      )
      .group('/schedules', (app) =>
        app
          .get('/', () => schedulesService.list())
          .get('/:id', ({ params }) => schedulesService.getById(params.id))
          // Everything below mutates — scoped here so it doesn't also gate the reads above.
          .onBeforeHandle(({ session }) => {
            if (!isAdmin(session.username)) throw errors.runs.forbidden();
          })
          .post(
            '/',
            ({ body, session, set }) => {
              set.status = 201;
              return schedulesService.create(body, session.username);
            },
            { body: createScheduleSchema },
          )
          .patch(
            '/:id',
            ({ params, body }) => schedulesService.update(params.id, body),
            { body: updateScheduleSchema },
          )
          .post('/:id/pause', ({ params }) => schedulesService.pause(params.id))
          .post('/:id/resume', ({ params }) =>
            schedulesService.resume(params.id),
          )
          .post('/:id/cancel', ({ params }) =>
            schedulesService.cancel(params.id),
          )
          .post('/:id/run-now', ({ params }) =>
            schedulesService.runNow(params.id),
          ),
      )
      .get(
        '/queue',
        ({ query }) =>
          query.kind === RunKind.WorkItemResolve
            ? getWorkItemResolveQueueStatus()
            : query.kind === RunKind.TaskResolve
              ? getTaskResolveQueueStatus()
              : getMrReviewQueueStatus(),
        { query: queueStatusQuerySchema },
      )
      .get('/users', () => authService.getUserCounts())
      .group('/analytics', (app) =>
        app
          .get(
            '/overview',
            ({ query }) =>
              analyticsService.getOverview({
                kind: query.kind,
                since: query.since ? new Date(query.since) : undefined,
              }),
            { query: analyticsOverviewQuerySchema },
          )
          .get(
            '/by-repo',
            ({ query }) =>
              analyticsService.getByRepo({
                kind: query.kind,
                since: query.since ? new Date(query.since) : undefined,
                projectId: query.projectId,
                limit: query.limit ?? 25,
                offset: query.offset ?? 0,
              }),
            { query: analyticsByRepoQuerySchema },
          )
          .get(
            '/trend',
            ({ query }) =>
              analyticsService.getTrend(
                query.kind,
                query.since ? new Date(query.since) : undefined,
              ),
            { query: analyticsTrendQuerySchema },
          )
          .get('/usage', () => analyticsService.getUsage()),
      )
      .get(
        '/memories',
        ({ query, session }) => {
          if (query.scope === MemoryScope.Personal) {
            return memoriesService.listForUser(session.id, query.categories);
          }
          if (!query.projectId) throw errors.memories.invalidQuery();
          return memoriesService.listForProject(
            query.projectId,
            query.categories,
          );
        },
        { query: listMemoriesQuerySchema },
      )
      .get('/memories/projects', () => memoriesService.projectCounts())
      .get('/memories/personal', ({ session }) =>
        memoriesService.personalCount(session.id),
      )
      .delete('/memories/:id', async ({ params, session, set }) => {
        if (isAdmin(session.username)) {
          await memoriesService.delete(params.id);
        } else {
          await memoriesService.deleteForUser(params.id, session.id);
        }
        set.status = 204;
      })
      .group('/settings', (app) =>
        app
          .get('/openrouter-key', ({ session }) =>
            settingsService.getOpenRouterKeyStatus(session.id),
          )
          .put(
            '/openrouter-key',
            async ({ session, body, set }) => {
              await settingsService.setOpenRouterKey(
                session.id,
                body.apiKey.trim(),
              );
              set.status = 204;
            },
            { body: setOpenRouterKeySchema },
          ),
      )
      .get('/models', () => llms)
      .group('/monitoring', (app) =>
        app
          .onBeforeHandle(({ session }) =>
            monitoringService.assertAdmin(session),
          )
          .get('/stack-containers', () =>
            monitoringService.getStackContainers(),
          )
          .get('/sandbox-fleet', () => monitoringService.getSandboxFleet())
          .get('/disk-usage', () => monitoringService.getDiskUsage()),
      ),
  );
