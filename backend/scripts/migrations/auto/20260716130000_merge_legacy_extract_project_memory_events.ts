import { type Kysely, sql, type SqlBool } from 'kysely';

// Old shape: one start/end pair per category. New shape: one pair per run. Backfills old runs into the new shape.
const LEGACY_START_FILTER = sql<SqlBool>`events @> '[{"event":"extract_project_memory_start"}]'::jsonb`;
const MIGRATED_START_FILTER = sql<SqlBool>`events @> '[{"data":{"migratedFromLegacy":true}}]'::jsonb`;

interface MemoryEvent {
  event: 'extract_project_memory_start' | 'extract_project_memory_end';
  data: any;
}

interface RunRow {
  id: string;
  events: MemoryEvent[] | null;
}

function mergeLegacyEvents(
  events: MemoryEvent[],
  runId: string,
): { events: MemoryEvent[]; logs: string[] } {
  const logs: string[] = [];
  const legacyStarts = events.filter(
    (e) => e.event === 'extract_project_memory_start' && 'category' in e.data,
  );
  if (!legacyStarts.length) return { events, logs };

  const endsById = new Map(
    events
      .filter((e) => e.event === 'extract_project_memory_end')
      .map((e) => [e.data.id, e]),
  );

  const categories: string[] = [];
  const decisions: any[] = [];
  let error = '';
  let prompt = '';
  let startTimestamp = Infinity;
  let endTimestamp = -Infinity;
  let anchorId: string | undefined;
  const consumedIds = new Set<string>();

  for (const start of legacyStarts) {
    consumedIds.add(start.data.id);
    const end = endsById.get(start.data.id);
    if (!end) {
      // Interrupted run (server restart/kill) before this category's end landed — unrecoverable, drop it.
      logs.push(
        `run ${runId}: category "${start.data.category}" (event ${start.data.id}) ` +
          `has no matching end event — dropping, unrecoverable`,
      );
      continue;
    }
    consumedIds.add(end.data.id);
    anchorId ??= start.data.id;
    categories.push(start.data.category);
    prompt ||= start.data.prompt;
    decisions.push(...end.data.decisions);
    if (!error && end.data.error) error = end.data.error;
    startTimestamp = Math.min(startTimestamp, start.data.timestamp);
    endTimestamp = Math.max(endTimestamp, end.data.timestamp);
  }

  // Rewrite the first successfully-paired pair (anchor) in place into the new shape; drop every other legacy pair.
  const newEvents = events
    .filter((e) => {
      const isLegacyPairEvent =
        (e.event === 'extract_project_memory_start' ||
          e.event === 'extract_project_memory_end') &&
        consumedIds.has(e.data.id);
      return !isLegacyPairEvent || e.data.id === anchorId;
    })
    .map((e) => {
      if (e.data.id !== anchorId) return e;
      if (e.event === 'extract_project_memory_start') {
        return {
          event: e.event,
          data: {
            id: anchorId,
            categories,
            prompt,
            timestamp: startTimestamp,
            migratedFromLegacy: true,
          },
        };
      }
      return {
        event: e.event,
        data: {
          id: anchorId,
          decisions,
          error,
          retries: 0,
          maxRetries: 0,
          timestamp: endTimestamp,
        },
      };
    });

  logs.push(
    categories.length
      ? `run ${runId}: merged ${categories.length} legacy pair(s) into one (${categories.join(', ')})`
      : `run ${runId}: all legacy pairs were orphaned, dropped with no replacement`,
  );

  return { events: newEvents, logs };
}

// Reverses mergeLegacyEvents(). Lossy: per-category attribution can't be reconstructed, so everything buckets onto the first category.
function splitMigratedEvents(
  events: MemoryEvent[],
  runId: string,
): { events: MemoryEvent[]; logs: string[] } {
  const logs: string[] = [];
  const endsById = new Map(
    events
      .filter((e) => e.event === 'extract_project_memory_end')
      .map((e) => [e.data.id, e]),
  );

  const skipEndIds = new Set<string>();
  const newEvents: MemoryEvent[] = [];

  for (const e of events) {
    if (e.event === 'extract_project_memory_end' && skipEndIds.has(e.data.id)) {
      continue;
    }
    if (
      e.event !== 'extract_project_memory_start' ||
      !e.data.migratedFromLegacy
    ) {
      newEvents.push(e);
      continue;
    }

    const end = endsById.get(e.data.id);
    const categories: string[] = e.data.categories;
    skipEndIds.add(e.data.id);

    logs.push(
      `run ${runId}: splitting back into ${categories.length} legacy pair(s) ` +
        `(${categories.join(', ')}) — all decisions and the error (if any) are bucketed ` +
        `onto "${categories[0]}" since the original per-category split can't be reconstructed exactly`,
    );

    categories.forEach((category, i) => {
      const startId = crypto.randomUUID();
      newEvents.push({
        event: 'extract_project_memory_start',
        data: {
          id: startId,
          category,
          prompt: e.data.prompt,
          timestamp: e.data.timestamp,
        },
      });
      newEvents.push({
        event: 'extract_project_memory_end',
        data: {
          id: startId,
          decisions: i === 0 ? (end?.data.decisions ?? []) : [],
          error: i === 0 ? (end?.data.error ?? '') : '',
          timestamp: end?.data.timestamp ?? e.data.timestamp,
        },
      });
    });
  }

  return { events: newEvents, logs };
}

// This is a data-shape backfill, not real run activity — disable the
// updated_at/thread-touch triggers so it doesn't skew run duration and thread
// recency for every row it rewrites.
async function withoutTouchTriggers(
  db: Kysely<any>,
  fn: () => Promise<void>,
): Promise<void> {
  await sql`ALTER TABLE runs DISABLE TRIGGER runs_set_updated_at`.execute(db);
  await sql`ALTER TABLE runs DISABLE TRIGGER runs_touch_thread`.execute(db);
  try {
    await fn();
  } finally {
    await sql`ALTER TABLE runs ENABLE TRIGGER runs_set_updated_at`.execute(db);
    await sql`ALTER TABLE runs ENABLE TRIGGER runs_touch_thread`.execute(db);
  }
}

export async function up(db: Kysely<any>): Promise<void> {
  const rows = (await db
    .selectFrom('runs')
    .select(['id', 'events'])
    .where(LEGACY_START_FILTER)
    .execute()) as RunRow[];

  await withoutTouchTriggers(db, async () => {
    for (const row of rows) {
      const { events, logs } = mergeLegacyEvents(row.events ?? [], row.id);
      logs.forEach((log) =>
        console.log(`[merge-legacy-extract-project-memory] ${log}`),
      );
      if (events === row.events) continue; // already new-shape, nothing to write

      await db
        .updateTable('runs')
        .set({ events: JSON.stringify(events) })
        .where('id', '=', row.id)
        .execute();
    }
  });
}

export async function down(db: Kysely<any>): Promise<void> {
  const rows = (await db
    .selectFrom('runs')
    .select(['id', 'events'])
    .where(MIGRATED_START_FILTER)
    .execute()) as RunRow[];

  await withoutTouchTriggers(db, async () => {
    for (const row of rows) {
      const { events, logs } = splitMigratedEvents(row.events ?? [], row.id);
      if (!logs.length) continue; // nothing migrated in this run, nothing to split back
      logs.forEach((log) =>
        console.warn(`[merge-legacy-extract-project-memory:down] ${log}`),
      );

      await db
        .updateTable('runs')
        .set({ events: JSON.stringify(events) })
        .where('id', '=', row.id)
        .execute();
    }
  });
}
