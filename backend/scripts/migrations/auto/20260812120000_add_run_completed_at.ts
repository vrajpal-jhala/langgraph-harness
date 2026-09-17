import { type Kysely, sql } from 'kysely';

import { withoutRunTouchTriggers } from './helpers.js';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('runs')
    .addColumn('completed_at', 'timestamptz')
    .execute();

  // Mirrors set_run_started_at: fires once, on the transition into a
  // terminal status, so no later write can move it — the same guarantee
  // started_at already has.
  await sql`
    CREATE OR REPLACE FUNCTION set_run_completed_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status IN ('completed', 'failed', 'interrupted')
         AND OLD.status IS DISTINCT FROM NEW.status
         AND NEW.completed_at IS NULL THEN
        NEW.completed_at = NOW();
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER runs_set_completed_at
      BEFORE UPDATE ON runs
      FOR EACH ROW EXECUTE FUNCTION set_run_completed_at()
  `.execute(db);

  // Backfill existing terminal runs from run_summaries — the only prior
  // record of run duration. Disabled so filling in this new column isn't
  // itself mistaken for run activity.
  await withoutRunTouchTriggers(db, async () => {
    await sql`
      UPDATE runs
      SET completed_at = runs.started_at + (run_summaries.duration_ms || ' milliseconds')::interval
      FROM run_summaries
      WHERE run_summaries.run_id = runs.id
        AND runs.started_at IS NOT NULL
        AND runs.completed_at IS NULL
    `.execute(db);
  });
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS runs_set_completed_at ON runs`.execute(db);
  await sql`DROP FUNCTION IF EXISTS set_run_completed_at`.execute(db);
  await db.schema.alterTable('runs').dropColumn('completed_at').execute();
}
