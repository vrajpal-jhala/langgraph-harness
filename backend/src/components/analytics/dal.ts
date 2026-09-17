import { sql } from 'kysely';

import type { NewRunSummary, NudgeStats, OwnCommentsSummary } from '#types.js';
import { RunKind } from '#types.js';

import { db } from '#utils/db.js';

// node-pg returns count/avg/percentile aggregates as strings (bigint/numeric) — Number(...) every one, same as runsDal.getStats.
const num = (value: unknown) => (value == null ? null : Number(value));

export const analyticsDal = {
  insert: async (summary: NewRunSummary) => {
    await db.insertInto('run_summaries').values(summary).execute();
  },

  updateOwnComments: async (
    runId: string,
    ownComments: OwnCommentsSummary | null,
  ) => {
    await db
      .updateTable('run_summaries')
      .set({ own_comments: ownComments })
      .where('run_id', '=', runId)
      .execute();
  },

  getOverview: async ({ kind, since }: { kind: RunKind; since?: Date }) => {
    const base = () =>
      db
        .selectFrom('run_summaries')
        .innerJoin('runs', 'runs.id', 'run_summaries.run_id')
        .where('runs.kind', '=', kind)
        .$if(!!since, (qb) => qb.where('runs.created_at', '>=', since!));

    const scalars = await base()
      .select((eb) => [
        eb.fn.countAll<string>().as('total'),
        sql<string>`count(distinct runs.thread_id)`.as('distinctThreads'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.success', '=', true)
          .as('successful'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'timeout')
          .as('timeouts'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'guardAbort')
          .as('guardAborts'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'manualAbort')
          .as('manualAborts'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'modelError')
          .as('modelErrors'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'serverRestart')
          .as('serverRestarts'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'generationLoop')
          .as('generationLoops'),
        eb.fn.avg<string>('duration_ms').as('avgDurationMs'),
        sql<string>`percentile_cont(0.5) within group (order by duration_ms)`.as(
          'medianDurationMs',
        ),
        sql<string>`percentile_cont(0.95) within group (order by duration_ms)`.as(
          'p95DurationMs',
        ),
        eb.fn.avg<string>('llm_calls').as('avgLlmCalls'),
        eb.fn.avg<string>('tool_calls').as('avgToolCalls'),
        eb.fn.avg<string>('unique_tools').as('avgUniqueTools'),
        eb.fn.avg<string>('repeated_tool_calls').as('avgRepeatedToolCalls'),
        eb.fn.avg<string>('model_retries').as('avgModelRetries'),
        eb.fn.avg<string>('checkpoints').as('avgCheckpoints'),
        eb.fn.avg<string>('total_tokens').as('avgTotalTokens'),
        eb.fn.avg<string>('max_context_size').as('avgMaxContextSize'),
        eb.fn.avg<string>('queue_wait_ms').as('avgQueueWaitMs'),
        eb.fn.avg<string>('llm_backend_wait_ms').as('avgLlmBackendWaitMs'),
        sql<string>`count(*) filter (where subagent_stats <> '{}'::jsonb)`.as(
          'subagentRuns',
        ),
      ])
      .executeTakeFirstOrThrow();

    const rows = await base()
      .select(['nudge_stats', 'comment_critic', 'memory_curator'])
      .execute();

    // Latest snapshot per thread only — a re-reviewed thread's own_comments would otherwise double count across runs.
    const ownCommentsRows = await base()
      .select(['runs.thread_id as threadId', 'own_comments as ownComments'])
      .where('run_summaries.own_comments', 'is not', null)
      .distinctOn('runs.thread_id')
      .orderBy('runs.thread_id')
      .orderBy('runs.created_at', 'desc')
      .execute();

    const nudgeStats: NudgeStats = {};
    const commentCritic = {
      runsScreened: 0,
      runsWithError: 0,
      verdicts: 0,
      dropped: 0,
      failed: 0,
    };
    const memoryCurator = {
      runsRun: 0,
      runsWithError: 0,
      added: 0,
      updated: 0,
      retired: 0,
      skipped: 0,
      missed: 0,
    };

    for (const row of rows) {
      for (const [middleware, stats] of Object.entries(row.nudge_stats)) {
        nudgeStats[middleware] ??= { fired: 0, resolved: 0, escalated: 0 };
        nudgeStats[middleware].fired += stats.fired;
        nudgeStats[middleware].resolved += stats.resolved;
        nudgeStats[middleware].escalated += stats.escalated;
      }
      if (row.comment_critic) {
        commentCritic.runsScreened++;
        commentCritic.verdicts += row.comment_critic.verdicts;
        commentCritic.dropped += row.comment_critic.dropped;
        commentCritic.failed += row.comment_critic.failed;
        if (row.comment_critic.hadError) commentCritic.runsWithError++;
      }
      if (row.memory_curator) {
        memoryCurator.runsRun++;
        memoryCurator.added += row.memory_curator.added;
        memoryCurator.updated += row.memory_curator.updated;
        memoryCurator.retired += row.memory_curator.retired;
        memoryCurator.skipped += row.memory_curator.skipped;
        memoryCurator.missed += row.memory_curator.missed;
        if (row.memory_curator.hadError) memoryCurator.runsWithError++;
      }
    }

    const ownComments = ownCommentsRows.reduce(
      (acc, row) => {
        if (!row.ownComments) return acc;
        acc.total += row.ownComments.total;
        acc.resolved += row.ownComments.resolved;
        return acc;
      },
      { total: 0, resolved: 0 },
    );

    const total = Number(scalars.total);
    const distinctThreads = Number(scalars.distinctThreads);

    return {
      total,
      distinctThreads,
      // How many times, on average, a thread gets (re-)run — high for mr-review means lots of re-pushes triggering re-review.
      avgRunsPerThread: distinctThreads ? total / distinctThreads : null,
      successful: Number(scalars.successful),
      errorKinds: {
        timeout: Number(scalars.timeouts),
        guardAbort: Number(scalars.guardAborts),
        manualAbort: Number(scalars.manualAborts),
        modelError: Number(scalars.modelErrors),
        serverRestart: Number(scalars.serverRestarts),
        generationLoop: Number(scalars.generationLoops),
      },
      avgDurationMs: num(scalars.avgDurationMs),
      medianDurationMs: num(scalars.medianDurationMs),
      p95DurationMs: num(scalars.p95DurationMs),
      avgLlmCalls: num(scalars.avgLlmCalls),
      avgToolCalls: num(scalars.avgToolCalls),
      avgUniqueTools: num(scalars.avgUniqueTools),
      avgRepeatedToolCalls: num(scalars.avgRepeatedToolCalls),
      avgModelRetries: num(scalars.avgModelRetries),
      avgCheckpoints: num(scalars.avgCheckpoints),
      avgTotalTokens: num(scalars.avgTotalTokens),
      avgMaxContextSize: num(scalars.avgMaxContextSize),
      avgQueueWaitMs: num(scalars.avgQueueWaitMs),
      avgLlmBackendWaitMs: num(scalars.avgLlmBackendWaitMs),
      // Bare count only — run_summaries.subagent_stats already retains a full per-category breakdown per run if a fuller dashboard is ever worth building.
      subagentRuns: Number(scalars.subagentRuns),
      nudgeStats,
      commentCritic,
      memoryCurator,
      ownComments: {
        total: ownComments.total,
        resolved: ownComments.resolved,
        acceptanceRate: ownComments.total
          ? ownComments.resolved / ownComments.total
          : null,
      },
    };
  },

  getByRepo: async ({
    kind,
    since,
    projectId,
    limit,
    offset,
  }: {
    kind: RunKind;
    since?: Date;
    projectId?: string;
    limit: number;
    offset: number;
  }) => {
    const repoExpr = sql<string>`coalesce(threads.metadata->>'project', '(unknown)')`;

    const base = () =>
      db
        .selectFrom('run_summaries')
        .innerJoin('runs', 'runs.id', 'run_summaries.run_id')
        .innerJoin('threads', 'threads.id', 'runs.thread_id')
        .where('runs.kind', '=', kind)
        .$if(!!since, (qb) => qb.where('runs.created_at', '>=', since!))
        .$if(projectId !== undefined, (qb) =>
          qb.where(sql<boolean>`${repoExpr} = ${projectId}`),
        );

    const rows = await base()
      .select((eb) => [
        repoExpr.as('repo'),
        eb.fn.countAll<string>().as('totalRuns'),
        sql<string>`count(distinct runs.thread_id)`.as('totalThreads'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.success', '=', false)
          .as('failedRuns'),
        eb.fn.avg<string>('duration_ms').as('avgDurationMs'),
      ])
      .groupBy(repoExpr)
      .orderBy('totalRuns', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const { total } = await db
      .selectFrom(
        base().select(repoExpr.as('repo')).groupBy(repoExpr).as('repos'),
      )
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow();

    return {
      repos: rows.map((row) => {
        const totalRuns = Number(row.totalRuns);
        const totalThreads = Number(row.totalThreads);
        return {
          repo: row.repo,
          totalRuns,
          totalThreads,
          failedRuns: Number(row.failedRuns),
          avgDurationMs: num(row.avgDurationMs),
          avgRunsPerThread: totalThreads
            ? Math.round((totalRuns / totalThreads) * 10) / 10
            : 0,
        };
      }),
      total: Number(total),
    };
  },

  getTrend: async ({ kind, since }: { kind: RunKind; since: Date }) => {
    const dayExpr = sql<Date>`date_trunc('day', runs.created_at)`;

    const rows = await db
      .selectFrom('run_summaries')
      .innerJoin('runs', 'runs.id', 'run_summaries.run_id')
      .where('runs.kind', '=', kind)
      .where('runs.created_at', '>=', since)
      .select((eb) => [
        dayExpr.as('day'),
        eb.fn.avg<string>('duration_ms').as('avgDurationMs'),
        eb.fn.avg<string>('queue_wait_ms').as('avgQueueWaitMs'),
        eb.fn.avg<string>('llm_backend_wait_ms').as('avgLlmBackendWaitMs'),
        eb.fn.countAll<string>().as('total'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.success', '=', true)
          .as('successful'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'timeout')
          .as('timeouts'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'guardAbort')
          .as('guardAborts'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'manualAbort')
          .as('manualAborts'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'modelError')
          .as('modelErrors'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'serverRestart')
          .as('serverRestarts'),
        eb.fn
          .countAll<string>()
          .filterWhere('run_summaries.error_kind', '=', 'generationLoop')
          .as('generationLoops'),
      ])
      .groupBy(dayExpr)
      .orderBy(dayExpr, 'asc')
      .execute();

    return rows.map((row) => {
      const total = Number(row.total);
      return {
        date: row.day.toISOString().slice(0, 10),
        avgDurationMs: num(row.avgDurationMs)!,
        avgQueueWaitMs: num(row.avgQueueWaitMs),
        avgLlmBackendWaitMs: num(row.avgLlmBackendWaitMs)!,
        total,
        successRate: total ? Number(row.successful) / total : null,
        timeout: Number(row.timeouts),
        guardAbort: Number(row.guardAborts),
        manualAbort: Number(row.manualAborts),
        modelError: Number(row.modelErrors),
        serverRestart: Number(row.serverRestarts),
        generationLoop: Number(row.generationLoops),
      };
    });
  },

  getUsage: async () => {
    // better-auth owns the `user` table via its own migration runner — not part of our Database interface, so this stays a raw count instead of pretending Kysely fully understands its schema.
    const [{ count: totalUsers }] = (
      await sql<{
        count: string;
      }>`select count(*)::text as count from "user"`.execute(db)
    ).rows;

    const [threadCounts, memoryCounts] = await Promise.all([
      db
        .selectFrom('threads')
        .select((eb) => [
          eb.fn
            .countAll<string>()
            .filterWhere('kind', '=', RunKind.MrReview)
            .as('reviews'),
          eb.fn
            .countAll<string>()
            .filterWhere('kind', '=', RunKind.Chat)
            .as('chats'),
        ])
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('memories')
        .select((eb) => [
          eb.fn
            .countAll<string>()
            .filterWhere('project_id', 'is not', null)
            .as('project'),
          eb.fn
            .countAll<string>()
            .filterWhere('user_id', 'is not', null)
            .as('personal'),
        ])
        .executeTakeFirstOrThrow(),
    ]);

    return {
      totalUsers: Number(totalUsers),
      totalReviews: Number(threadCounts.reviews),
      totalChats: Number(threadCounts.chats),
      totalProjectMemories: Number(memoryCounts.project),
      totalPersonalMemories: Number(memoryCounts.personal),
    };
  },
};
