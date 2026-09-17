import { type Kysely, sql } from 'kysely';

// Named allowlist, not a blanket disable — a future integrity-enforcing trigger should still fire by default.
export async function withoutRunTouchTriggers(
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

export async function withoutThreadTouchTrigger(
  db: Kysely<any>,
  fn: () => Promise<void>,
): Promise<void> {
  await sql`ALTER TABLE threads DISABLE TRIGGER threads_set_updated_at`.execute(
    db,
  );
  try {
    await fn();
  } finally {
    await sql`ALTER TABLE threads ENABLE TRIGGER threads_set_updated_at`.execute(
      db,
    );
  }
}
