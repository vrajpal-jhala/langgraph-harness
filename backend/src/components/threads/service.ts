import { RunKind, RunStatus, type Session, ThreadFilters } from '#types.js';

import { runsDal } from '#components/runs/dal.js';
import { runsService } from '#components/runs/service.js';
import { settingsService } from '#components/settings/service.js';
import { workflowsService } from '#components/workflows/service.js';
import { threadsDal } from './dal.js';

import { checkpointer } from '#utils/db.js';
import { errors } from '#utils/errors.js';
import { gitHosts } from '#utils/git-host.js';
import { logger } from '#utils/logger.js';

async function checkThreadAccess(
  id: string,
  session: Session,
  action: 'read' | 'mutate',
) {
  const thread = await threadsDal.findById(id);
  if (!thread) throw errors.threads.notFound();
  workflowsService.forKind(thread.kind).checkAccess(thread, session, action);
}

export const threadsService = {
  // 'chat' threads are owned by userId (always the caller's own verified session, never client-supplied); anything else is public, as with mr-review.
  create: async (title: string, kind: RunKind, userId: string) => {
    if (kind === RunKind.Chat) {
      // Rejected here, not just at run-creation, so a missing key never leaves behind an empty thread.
      if (!(await settingsService.getOpenRouterKey(userId))) {
        throw errors.chat.missingOpenRouterKey();
      }
      return threadsDal.insert({ title, kind: RunKind.Chat, user_id: userId });
    }
    return threadsDal.insert({ title, kind });
  },

  update: (id: string, title: string) => threadsDal.update(id, { title }),

  stopRuns: async (id: string, reason: string) => {
    // Cleared first: a run ending, even by abort, is what drains a coalesced rerun.
    await threadsDal.consumePendingRerun(id);

    const runs = await runsDal.getByThread(id);

    for (const run of runs) {
      if (run.status === RunStatus.RUNNING) {
        try {
          runsService.abort(run.id, reason);
        } catch {
          // Best-effort abort; run may have already settled.
        }
      } else if (run.status === RunStatus.QUEUED) {
        await workflowsService.forKind(run.kind).cancelPendingRun?.(run);
        await runsService.failById(run.id, id, reason);
      }
    }
  },

  delete: async (id: string) => {
    const thread = await threadsDal.findById(id);
    if (!thread) throw errors.threads.notFound();

    await threadsService.stopRuns(id, 'Thread deleted');
    await checkpointer.deleteThread(id);
    const deleted = await threadsDal.deleteById(id);
    if (!deleted) throw errors.threads.notFound();
  },

  // Purges LangGraph's checkpoint state (the actual storage bloat) but keeps the thread/runs/events rows — those stay the source of truth for analytics and history.
  archive: async (id: string) => {
    await checkpointer.deleteThread(id);
    await threadsDal.archive(id);
  },

  sweepStale: async (ids: string[], logLabel: string) => {
    if (!ids.length) return;
    logger.info({ count: ids.length }, `[${logLabel}] sweeping stale threads`);
    for (const id of ids) {
      await threadsService
        .archive(id)
        .catch((err) =>
          logger.error({ err, id }, `[${logLabel}] sweep failed`),
        );
    }
  },

  getById: async (id: string) => {
    const thread = await threadsDal.findByIdWithStatus(id);
    if (!thread) throw errors.threads.notFound();
    return thread;
  },

  assertAccess: (id: string, session: Session) =>
    checkThreadAccess(id, session, 'read'),

  assertCanMutate: (id: string, session: Session) =>
    checkThreadAccess(id, session, 'mutate'),

  list: (params: ThreadFilters) => threadsDal.list(params),

  // repoKey is what memories are stored under, so the memories page can open a GitHub repo's.
  listProjects: async () =>
    (await threadsDal.listProjects()).map(({ provider, project }) => ({
      provider,
      project,
      repoKey: gitHosts[provider].repoKey(project),
    })),
};
