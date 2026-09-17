import { type Kysely, sql, type SqlBool } from 'kysely';

// finalAnswerGuardMiddleware was renamed to trailingQuestionGuardMiddleware;
// backfill the `data.middleware` value on historical corrective_nudge_start/end
// events so old runs display consistently with new ones instead of relying on
// a permanent frontend compat mapping.
const OLD_VALUE = 'FinalAnswerGuard';
const NEW_VALUE = 'TrailingQuestionGuard';

const OLD_VALUE_FILTER = sql<SqlBool>`events @> '[{"data":{"middleware":"FinalAnswerGuard"}}]'::jsonb`;
const NEW_VALUE_FILTER = sql<SqlBool>`events @> '[{"data":{"middleware":"TrailingQuestionGuard"}}]'::jsonb`;

interface RunEventLike {
  event: string;
  data: { middleware?: string; [key: string]: unknown };
}

interface RunRow {
  id: string;
  events: RunEventLike[] | null;
}

function renameMiddleware(
  events: RunEventLike[],
  from: string,
  to: string,
): RunEventLike[] {
  return events.map((e) =>
    e.data?.middleware === from
      ? { ...e, data: { ...e.data, middleware: to } }
      : e,
  );
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
    .where(OLD_VALUE_FILTER)
    .execute()) as RunRow[];

  await withoutTouchTriggers(db, async () => {
    for (const row of rows) {
      const events = renameMiddleware(row.events ?? [], OLD_VALUE, NEW_VALUE);

      await db
        .updateTable('runs')
        .set({ events: JSON.stringify(events) })
        .where('id', '=', row.id)
        .execute();
    }
  });

  console.log(
    `[rename-final-answer-guard-middleware] renamed middleware on ${rows.length} run(s)`,
  );
}

// Lossy on rollback: any run created after the code rename shipped legitimately
// has TrailingQuestionGuard and gets renamed back to FinalAnswerGuard too —
// there's no way to distinguish "always was new" from "migrated to new" here.
export async function down(db: Kysely<any>): Promise<void> {
  const rows = (await db
    .selectFrom('runs')
    .select(['id', 'events'])
    .where(NEW_VALUE_FILTER)
    .execute()) as RunRow[];

  await withoutTouchTriggers(db, async () => {
    for (const row of rows) {
      const events = renameMiddleware(row.events ?? [], NEW_VALUE, OLD_VALUE);

      await db
        .updateTable('runs')
        .set({ events: JSON.stringify(events) })
        .where('id', '=', row.id)
        .execute();
    }
  });

  console.log(
    `[rename-final-answer-guard-middleware:down] reverted middleware on ${rows.length} run(s)`,
  );
}
