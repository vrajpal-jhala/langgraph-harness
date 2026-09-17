import { sql } from 'kysely';

import type { NewRun, RunUpdate, SearchMode } from '#types.js';
import { RunKind, RunStatus } from '#types.js';

import { db } from '#utils/db.js';
import { matchExpression } from '#utils/searchPattern.js';

export const runsDal = {
  insert: async (values: NewRun) => {
    return db
      .insertInto('runs')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  update: async ({ events, ...rest }: RunUpdate, id: string) => {
    return db
      .updateTable('runs')
      .set({
        ...rest,
        ...(events !== undefined && {
          events: sql`${JSON.stringify(events)}::jsonb`,
        }),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  },

  findById: async (id: string) => {
    return db
      .selectFrom('runs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  },

  findLatestByThread: async (threadId: string) => {
    return db
      .selectFrom('runs')
      .selectAll()
      .where('thread_id', '=', threadId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  },

  hasActive: async (threadId: string) => {
    const row = await db
      .selectFrom('runs')
      .select('id')
      .where('thread_id', '=', threadId)
      .where('status', 'in', [RunStatus.QUEUED, RunStatus.RUNNING])
      .executeTakeFirst();
    return !!row;
  },

  countByThread: async (threadId: string): Promise<number> => {
    const { count } = await db
      .selectFrom('runs')
      .select(db.fn.countAll<number>().as('count'))
      .where('thread_id', '=', threadId)
      .where('status', '!=', RunStatus.SUPERSEDED)
      .executeTakeFirstOrThrow();
    return Number(count);
  },

  failPending: async (threadId: string) => {
    await db
      .updateTable('runs')
      .set({ status: RunStatus.FAILED, error: 'Job stalled' })
      .where('thread_id', '=', threadId)
      .where('status', 'in', [RunStatus.QUEUED, RunStatus.RUNNING])
      .execute();
  },

  failAllPending: async () => {
    return db.transaction().execute(async (trx) => {
      // BullMQ's delayed jobs will re-create QUEUED runs naturally; this just gives old records a clean terminal state.
      const queued = await trx
        .updateTable('runs')
        .set({ status: RunStatus.FAILED, error: 'Server restarted' })
        .where('status', '=', RunStatus.QUEUED)
        .returningAll()
        .execute();

      // Returns full data so the caller can re-enqueue via BullMQ — the original job already completed, so nothing's left in Redis to conflict with.
      const running = await trx
        .updateTable('runs')
        .set({ status: RunStatus.FAILED, error: 'Server restarted' })
        .where('status', '=', RunStatus.RUNNING)
        .returningAll()
        .execute();

      const threadIds = [
        ...new Set([
          ...queued.map((r) => r.thread_id),
          ...running.map((r) => r.thread_id),
        ]),
      ];

      return { threadIds, interruptedRuns: running, orphanedRuns: queued };
    });
  },

  supersedeById: async (id: string) => {
    const result = await db
      .updateTable('runs')
      .set({
        status: RunStatus.SUPERSEDED,
        error: 'Superseded by a newer push',
      })
      .where('id', '=', id)
      .where('status', '=', RunStatus.QUEUED)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  },

  // Plain substring match, not a jsonb path query, since input's shape differs by workflow (only chat has images).
  isUploadReferenced: async (ref: string) => {
    const row = await db
      .selectFrom('runs')
      .select('id')
      .where(sql<boolean>`input::text LIKE ${'%' + ref + '%'}`)
      .executeTakeFirst();
    return !!row;
  },

  getByThread: async (threadId: string) => {
    return db
      .selectFrom('runs')
      .selectAll()
      .where('thread_id', '=', threadId)
      .where('status', '!=', RunStatus.SUPERSEDED)
      .orderBy('created_at', 'asc')
      .execute();
  },

  getByThreadPage: async (threadId: string, limit: number, offset: number) => {
    const buildQuery = () =>
      db
        .selectFrom('runs')
        .where('thread_id', '=', threadId)
        .where('status', '!=', RunStatus.SUPERSEDED);

    const [runs, { count }] = await Promise.all([
      buildQuery()
        .selectAll()
        .orderBy('created_at', 'asc')
        .limit(limit)
        .offset(offset)
        .execute(),
      buildQuery()
        .select(db.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
    ]);

    return { runs, total: Number(count) };
  },

  // Sequential-scans input/events::text — fine at current data volume; revisit with an index if it gets slow.
  searchContent: async ({
    pattern,
    mode,
    projects,
    limit,
  }: {
    pattern: string;
    mode?: SearchMode;
    projects?: string[];
    limit: number;
  }) => {
    return db
      .selectFrom('runs')
      .innerJoin('threads', 'threads.id', 'runs.thread_id')
      .select([
        'runs.id as runId',
        'runs.thread_id as threadId',
        'threads.title as title',
        'runs.input as input',
        'runs.events as events',
        'runs.created_at as createdAt',
      ])
      .where('threads.kind', '=', RunKind.MrReview)
      .where('runs.status', '!=', RunStatus.SUPERSEDED)
      .$if(!!projects?.length, (qb) =>
        qb.where(
          sql<boolean>`threads.metadata->>'project' = ANY(${projects}::text[])`,
        ),
      )
      .where(
        sql<boolean>`(${matchExpression(sql`runs.input::text`, pattern, mode)} OR ${matchExpression(sql`runs.events::text`, pattern, mode)})`,
      )
      .orderBy('runs.created_at', 'desc')
      .limit(limit)
      .execute();
  },

  // userId is required (not optional like searchContent's projects filter) — this is the only thing standing between one user's chat history and another's.
  searchChatContent: async ({
    pattern,
    mode,
    userId,
    excludeId,
    limit,
  }: {
    pattern: string;
    mode?: SearchMode;
    userId: string;
    excludeId?: string;
    limit: number;
  }) => {
    return db
      .selectFrom('runs')
      .innerJoin('threads', 'threads.id', 'runs.thread_id')
      .select([
        'runs.id as runId',
        'runs.thread_id as threadId',
        'threads.title as title',
        'runs.input as input',
        'runs.events as events',
        'runs.created_at as createdAt',
      ])
      .where('threads.kind', '=', RunKind.Chat)
      .where('threads.user_id', '=', userId)
      .where('runs.status', '!=', RunStatus.SUPERSEDED)
      .$if(!!excludeId, (qb) => qb.where('threads.id', '!=', excludeId!))
      .where(
        sql<boolean>`(${matchExpression(sql`runs.input::text`, pattern, mode)} OR ${matchExpression(sql`runs.events::text`, pattern, mode)})`,
      )
      .orderBy('runs.created_at', 'desc')
      .limit(limit)
      .execute();
  },

  getStats: async (kind: RunKind) => {
    const row = await db
      .selectFrom('runs')
      .select((eb) => [
        eb.fn
          .countAll<number>()
          .filterWhere('status', '=', RunStatus.QUEUED)
          .as('queued'),
        eb.fn
          .countAll<number>()
          .filterWhere('status', '=', RunStatus.RUNNING)
          .as('running'),
        eb.fn
          .countAll<number>()
          .filterWhere('status', '=', RunStatus.COMPLETED)
          .as('completed'),
        eb.fn
          .countAll<number>()
          .filterWhere('status', '=', RunStatus.FAILED)
          .as('failed'),
        eb.fn.max('created_at').as('last_run_at'),
      ])
      .where('kind', '=', kind)
      .executeTakeFirst();

    const byStatus: Partial<Record<RunStatus, number>> = {
      [RunStatus.QUEUED]: Number(row?.queued ?? 0),
      [RunStatus.RUNNING]: Number(row?.running ?? 0),
      [RunStatus.COMPLETED]: Number(row?.completed ?? 0),
      [RunStatus.FAILED]: Number(row?.failed ?? 0),
    };

    return {
      byStatus,
      totalRuns: Object.values(byStatus).reduce(
        (sum, count) => sum + (count ?? 0),
        0,
      ),
      lastRunAt: row?.last_run_at ?? null,
    };
  },
};
