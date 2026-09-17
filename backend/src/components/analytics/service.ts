import type { ErrorKind, Run, RunEvent, RunKind } from '#types.js';

import { runsDal } from '#components/runs/dal.js';
import { analyticsDal } from './dal.js';
import { parseOwnComments, summarizeRun } from './summarize.js';

import { fetchMrDiscussions } from '#utils/gitlab.js';
import { logger } from '#utils/logger.js';

const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export const analyticsService = {
  recordRun: (
    runId: string,
    durationMs: number,
    success: boolean,
    errorKind: ErrorKind | undefined,
    events: RunEvent[],
    startedAtMs?: number,
  ) =>
    analyticsDal.insert({
      run_id: runId,
      duration_ms: durationMs,
      success,
      error_kind: errorKind ?? null,
      ...summarizeRun(events, startedAtMs),
    }),

  recordOrphanedRuns: (runs: Run[]) =>
    Promise.all(
      runs.map(async (run) => {
        const durationMs = run.started_at
          ? Date.now() - run.started_at.getTime()
          : 0;
        return analyticsService
          .recordRun(
            run.id,
            durationMs,
            false,
            'serverRestart',
            run.events,
            run.started_at?.getTime(),
          )
          .catch((err) =>
            logger.error({ err, runId: run.id }, '[analytics] record failed'),
          );
      }),
    ),

  getOverview: (params: { kind: RunKind; since?: Date }) =>
    analyticsDal.getOverview({
      ...params,
      since: params.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS),
    }),

  getByRepo: (params: {
    kind: RunKind;
    since?: Date;
    projectId?: string;
    limit: number;
    offset: number;
  }) =>
    analyticsDal.getByRepo({
      ...params,
      since: params.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS),
    }),

  getTrend: (kind: RunKind, since?: Date) =>
    analyticsDal.getTrend({
      kind,
      since: since ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS),
    }),

  getUsage: () => analyticsDal.getUsage(),

  recordFinalOwnComments: async (
    threadId: string,
    projectId: string,
    mrIid: string,
  ) => {
    const run = await runsDal.findLatestByThread(threadId);
    if (!run) return;

    const discussions = await fetchMrDiscussions(projectId, mrIid);
    // No age cutoff: this is the last check we'll ever make for this thread.
    await analyticsDal.updateOwnComments(run.id, parseOwnComments(discussions));
  },
};
