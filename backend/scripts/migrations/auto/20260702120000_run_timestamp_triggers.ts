import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // started_at is set once, on the queued -> running transition — guarded so
  // later updates (completed/failed) don't reset it. Keeping it DB-managed
  // (like updated_at already is) means started_at and updated_at always come
  // from the same clock, so run durations can never go negative.
  await sql`
    CREATE OR REPLACE FUNCTION set_run_started_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status = 'running' AND OLD.status IS DISTINCT FROM 'running' THEN
        NEW.started_at = NOW();
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER runs_set_started_at
      BEFORE UPDATE ON runs
      FOR EACH ROW EXECUTE FUNCTION set_run_started_at()
  `.execute(db);

  // Threads have no way to know a child run changed — this cascades any
  // insert/update/delete on runs into a touch of the owning thread's
  // updated_at, so thread recency stays accurate without the app having to
  // remember to call it manually on every run mutation.
  await sql`
    CREATE OR REPLACE FUNCTION touch_thread_from_run()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE threads SET updated_at = NOW()
      WHERE id = COALESCE(NEW.thread_id, OLD.thread_id);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER runs_touch_thread
      AFTER INSERT OR UPDATE OR DELETE ON runs
      FOR EACH ROW EXECUTE FUNCTION touch_thread_from_run()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS runs_touch_thread ON runs`.execute(db);
  await sql`DROP FUNCTION IF EXISTS touch_thread_from_run`.execute(db);
  await sql`DROP TRIGGER IF EXISTS runs_set_started_at ON runs`.execute(db);
  await sql`DROP FUNCTION IF EXISTS set_run_started_at`.execute(db);
}
