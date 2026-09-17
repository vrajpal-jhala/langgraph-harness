import { sql, type SqlBool } from 'kysely';

import type {
  NewThread,
  ThreadFilters,
  ThreadMetadata,
  ThreadUpdate,
} from '#types.js';
import { RunKind, RunStatus } from '#types.js';

import { db } from '#utils/db.js';
import { matchExpression } from '#utils/searchPattern.js';

export const threadsDal = {
  insert: async (values: NewThread) => {
    return db
      .insertInto('threads')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  update: async (id: string, values: ThreadUpdate) => {
    return db
      .updateTable('threads')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  },

  // Archiving isn't activity — skip the trigger so it doesn't bump updated_at.
  archive: async (id: string) => {
    await sql`ALTER TABLE threads DISABLE TRIGGER threads_set_updated_at`.execute(
      db,
    );
    try {
      return await db
        .updateTable('threads')
        .set({ archived_at: new Date() })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
    } finally {
      await sql`ALTER TABLE threads ENABLE TRIGGER threads_set_updated_at`.execute(
        db,
      );
    }
  },

  findById: async (id: string) => {
    return db
      .selectFrom('threads')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  },

  deleteById: async (id: string) => {
    const result = await db
      .deleteFrom('threads')
      .where('id', '=', id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  },

  findByIdWithStatus: async (id: string) => {
    return db
      .selectFrom('threads')
      .selectAll('threads')
      .select((eb) =>
        eb
          .selectFrom('runs')
          .select('status')
          .whereRef('runs.thread_id', '=', 'threads.id')
          .where('runs.status', '!=', RunStatus.SUPERSEDED)
          .orderBy('runs.created_at', 'desc')
          .limit(1)
          .as('latest_run_status'),
      )
      .select((eb) =>
        eb
          .selectFrom('runs')
          .select('started_at')
          .whereRef('runs.thread_id', '=', 'threads.id')
          .where('runs.status', '!=', RunStatus.SUPERSEDED)
          .orderBy('runs.created_at', 'desc')
          .limit(1)
          .as('latest_run_started_at'),
      )
      .select((eb) =>
        eb
          .selectFrom('runs')
          .select('completed_at')
          .whereRef('runs.thread_id', '=', 'threads.id')
          .where('runs.status', '!=', RunStatus.SUPERSEDED)
          .orderBy('runs.created_at', 'desc')
          .limit(1)
          .as('latest_run_completed_at'),
      )
      .where('threads.id', '=', id)
      .executeTakeFirst();
  },

  findByMetadata: async (subset: ThreadMetadata) => {
    return db
      .selectFrom('threads')
      .selectAll()
      .where(sql<SqlBool>`metadata @> ${JSON.stringify(subset)}::jsonb`)
      .executeTakeFirst();
  },

  // Recency-capped, not paginated — this only backs a schedule's "recent runs" list.
  listByScheduleId: async (scheduleId: string, limit = 50) => {
    return db
      .with('latest_runs', (cte) =>
        cte
          .selectFrom('runs')
          .select(['thread_id', 'status', 'started_at', 'completed_at'])
          .where('status', '!=', RunStatus.SUPERSEDED)
          .distinctOn('runs.thread_id')
          .orderBy('runs.thread_id')
          .orderBy('runs.created_at', 'desc'),
      )
      .selectFrom('threads')
      .leftJoin('latest_runs', 'latest_runs.thread_id', 'threads.id')
      .where(sql<SqlBool>`threads.metadata->>'scheduleId' = ${scheduleId}`)
      .selectAll('threads')
      .select([
        'latest_runs.status as latest_run_status',
        'latest_runs.started_at as latest_run_started_at',
        'latest_runs.completed_at as latest_run_completed_at',
      ])
      .orderBy('threads.created_at', 'desc')
      .limit(limit)
      .execute();
  },

  mergeMetadata: async (id: string, patch: ThreadMetadata) => {
    await db
      .updateTable('threads')
      .set({
        metadata: sql`coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      })
      .where('id', '=', id)
      .execute();
  },

  setPendingRerun: async (id: string) => {
    await db
      .updateTable('threads')
      .set({
        metadata: sql`coalesce(metadata, '{}'::jsonb) || '{"pendingRerun": true}'::jsonb`,
      })
      .where('id', '=', id)
      .execute();
  },

  consumePendingRerun: async (id: string): Promise<boolean> => {
    const result = await db
      .updateTable('threads')
      .set({ metadata: sql`metadata - 'pendingRerun'` })
      .where('id', '=', id)
      .where(sql<SqlBool>`metadata->>'pendingRerun' = 'true'`)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  },

  list: async ({
    kinds,
    projects,
    statuses,
    userId,
    title,
    excludeId,
    limit,
    offset,
  }: ThreadFilters) => {
    // DISTINCT ON computes the latest run once, instead of a correlated subquery re-evaluated per thread row/filter.
    const buildQuery = () =>
      db
        .with('latest_runs', (cte) =>
          cte
            .selectFrom('runs')
            .select(['thread_id', 'status', 'started_at', 'completed_at'])
            .where('status', '!=', RunStatus.SUPERSEDED)
            .distinctOn('runs.thread_id')
            .orderBy('runs.thread_id')
            .orderBy('runs.created_at', 'desc'),
        )
        .with('run_stats', (cte) =>
          cte
            .selectFrom('runs')
            .select([
              'thread_id',
              db.fn.countAll<number>().as('total_count'),
              (eb) =>
                eb.fn
                  .countAll<number>()
                  .filterWhere('status', '=', RunStatus.FAILED)
                  .as('failed_count'),
            ])
            .where('status', '!=', RunStatus.SUPERSEDED)
            .groupBy('thread_id'),
        )
        .selectFrom('threads')
        .leftJoin('latest_runs', 'latest_runs.thread_id', 'threads.id')
        .leftJoin('run_stats', 'run_stats.thread_id', 'threads.id')
        .where(
          'threads.kind',
          'in',
          kinds?.length
            ? kinds
            : [RunKind.MrReview, RunKind.WorkItemResolve, RunKind.TaskResolve],
        )
        // 'chat' additionally scopes to the caller's own threads (mr-review/work-item-resolve threads have no owner) — scoped to chat rows only, so a mixed `kinds` request doesn't also hide the other kinds' threads.
        .$if(!!kinds?.includes(RunKind.Chat), (qb) =>
          qb.where((eb) =>
            eb.or([
              eb('threads.kind', '!=', RunKind.Chat),
              eb('threads.user_id', '=', userId ?? null),
            ]),
          ),
        )
        // Schedule-spawned runs live under their schedule's own run history, not here.
        .where(sql<SqlBool>`threads.metadata->>'scheduleId' IS NULL`)
        .$if(!!title, (qb) =>
          qb.where(
            matchExpression(
              sql.ref('threads.title'),
              title!.pattern,
              title!.mode,
            ),
          ),
        )
        .$if(!!projects?.length, (qb) =>
          qb.where(
            sql<SqlBool>`threads.metadata->>'project' = ANY(${projects}::text[])`,
          ),
        )
        .$if(!!statuses?.length, (qb) =>
          qb.where('latest_runs.status', 'in', statuses as RunStatus[]),
        )
        .$if(!!excludeId, (qb) => qb.where('threads.id', '!=', excludeId!));

    const [data, { count }] = await Promise.all([
      buildQuery()
        .selectAll('threads')
        .select([
          'latest_runs.status as latest_run_status',
          'latest_runs.started_at as latest_run_started_at',
          'latest_runs.completed_at as latest_run_completed_at',
          sql<number>`coalesce(run_stats.total_count, 0)`.as('run_count'),
          sql<number>`coalesce(run_stats.failed_count, 0)`.as('failure_count'),
        ])
        .orderBy('threads.updated_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      buildQuery()
        .select(db.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
    ]);

    return { data, total: Number(count) };
  },

  listProjects: async () => {
    const rows = await db
      .selectFrom('threads')
      .select(sql<string>`metadata->>'project'`.as('project'))
      .where(sql<SqlBool>`metadata->>'project' IS NOT NULL`)
      .distinct()
      .orderBy(sql`metadata->>'project'`)
      .execute();

    return rows.map((r) => r.project);
  },

  // Excludes threads with any run still queued/running, even if it isn't the latest one, so a sweep never races an in-flight run.
  findStaleThreadIds: async (kind: RunKind, retentionMs: number) => {
    const rows = await db
      .selectFrom('threads')
      .select('id')
      .where('kind', '=', kind)
      .where('archived_at', 'is', null)
      .where(
        'updated_at',
        '<',
        sql<Date>`now() - make_interval(secs => ${retentionMs / 1000})`,
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('runs')
              .select('id')
              .whereRef('runs.thread_id', '=', 'threads.id')
              .where('runs.status', 'in', [
                RunStatus.QUEUED,
                RunStatus.RUNNING,
              ]),
          ),
        ),
      )
      .execute();

    return rows.map((r) => r.id);
  },
};
