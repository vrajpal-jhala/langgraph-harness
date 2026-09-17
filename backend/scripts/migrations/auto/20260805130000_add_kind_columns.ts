import { type Kysely, sql } from 'kysely';

import {
  withoutRunTouchTriggers,
  withoutThreadTouchTrigger,
} from './helpers.js';

// Replaces two divergent kind-inference heuristics (input.kind absence, metadata.user_id presence) with one required column.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('runs').addColumn('kind', 'text').execute();
  await db.schema.alterTable('threads').addColumn('kind', 'text').execute();

  await withoutRunTouchTriggers(db, async () => {
    // Backfills input.kind too, so MrReviewRunInput.kind can be required like ChatRunInput's.
    await sql`
      UPDATE runs
      SET input = input || '{"kind":"mr_review"}'::jsonb
      WHERE input->>'kind' IS NULL
    `.execute(db);

    await sql`UPDATE runs SET kind = input->>'kind'`.execute(db);
  });

  await withoutThreadTouchTrigger(db, async () => {
    await sql`
      UPDATE threads
      SET kind = CASE
        WHEN metadata->>'user_id' IS NOT NULL THEN 'chat'
        ELSE 'mr_review'
      END
    `.execute(db);
  });

  await db.schema
    .alterTable('runs')
    .alterColumn('kind', (col) => col.setNotNull())
    .execute();
  await db.schema
    .alterTable('threads')
    .alterColumn('kind', (col) => col.setNotNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('runs').dropColumn('kind').execute();
  await db.schema.alterTable('threads').dropColumn('kind').execute();
}
