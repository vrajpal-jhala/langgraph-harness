import { type Kysely, sql, type SqlBool } from 'kysely';

// Runs the previous migration touched — the only rows whose updated_at got clobbered.
const MIGRATED_MARKER_FILTER = sql<SqlBool>`events @> '[{"data":{"migratedFromLegacy":true}}]'::jsonb`;

interface RunRow {
  id: string;
  thread_id: string;
  updated_at: Date;
  events: { data?: { timestamp?: number } }[] | null;
}

function latestEventTimestamp(events: RunRow['events']): Date | null {
  const timestamps = (events ?? [])
    .map((e) => e.data?.timestamp)
    .filter((t): t is number => typeof t === 'number');
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

export async function up(db: Kysely<any>): Promise<void> {
  const rows = (await db
    .selectFrom('runs')
    .select(['id', 'thread_id', 'updated_at', 'events'])
    .where(MIGRATED_MARKER_FILTER)
    .execute()) as RunRow[];

  await sql`ALTER TABLE runs DISABLE TRIGGER runs_set_updated_at`.execute(db);
  await sql`ALTER TABLE runs DISABLE TRIGGER runs_touch_thread`.execute(db);
  await sql`ALTER TABLE threads DISABLE TRIGGER threads_set_updated_at`.execute(
    db,
  );

  try {
    const affectedThreadIds = new Set<string>();

    for (const row of rows) {
      const correctedAt = latestEventTimestamp(row.events);
      if (!correctedAt) continue; // no timestamped events to recover a real value from

      affectedThreadIds.add(row.thread_id);
      // Only ever correct downward — the bug can only have moved updated_at later than reality.
      await db
        .updateTable('runs')
        .set({ updated_at: correctedAt })
        .where('id', '=', row.id)
        .where('updated_at', '>', correctedAt)
        .execute();
    }

    for (const threadId of affectedThreadIds) {
      const latest = await db
        .selectFrom('runs')
        .select((eb) => eb.fn.max('updated_at').as('last'))
        .where('thread_id', '=', threadId)
        .executeTakeFirst();
      if (!latest?.last) continue;

      await db
        .updateTable('threads')
        .set({ updated_at: latest.last })
        .where('id', '=', threadId)
        .where('updated_at', '>', latest.last)
        .execute();
    }
  } finally {
    await sql`ALTER TABLE runs ENABLE TRIGGER runs_set_updated_at`.execute(db);
    await sql`ALTER TABLE runs ENABLE TRIGGER runs_touch_thread`.execute(db);
    await sql`ALTER TABLE threads ENABLE TRIGGER threads_set_updated_at`.execute(
      db,
    );
  }
}

// No db param (unlike migration 1's down) — this migration only ever logs, it never queries.
export async function down(): Promise<void> {
  console.warn(
    '[repair-thread-updated-at:down] irreversible — original corrupted values are gone, nothing to restore',
  );
}
