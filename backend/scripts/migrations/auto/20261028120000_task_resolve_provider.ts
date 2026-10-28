import { type Kysely, sql } from 'kysely';

import {
  withoutRunTouchTriggers,
  withoutThreadTouchTrigger,
} from './helpers.js';

// Every task-resolve run and schedule before GitHub support was GitLab.
export async function up(db: Kysely<any>): Promise<void> {
  let total = 0;

  await withoutRunTouchTriggers(db, async () => {
    const { numUpdatedRows } = await db
      .updateTable('runs')
      .set({ input: sql`input || '{"provider": "gitlab"}'::jsonb` })
      .where('kind', '=', 'task_resolve')
      .where(sql<boolean>`input -> 'provider' IS NULL`)
      .executeTakeFirst();
    console.log(
      `[task-resolve-provider] run input provider added: ${numUpdatedRows} run(s)`,
    );
    total += Number(numUpdatedRows);
  });

  // Every merge request opened before GitHub's draft fallback was a draft.
  await withoutThreadTouchTrigger(db, async () => {
    const { numUpdatedRows } = await db
      .updateTable('threads')
      .set({
        metadata: sql`metadata || '{"codeChangeRequestOpenedAsDraft": true}'::jsonb`,
      })
      .where('kind', '=', 'task_resolve')
      .where(sql<boolean>`metadata -> 'codeChangeRequestNumber' IS NOT NULL`)
      .where(sql<boolean>`metadata -> 'codeChangeRequestOpenedAsDraft' IS NULL`)
      .executeTakeFirst();
    console.log(
      `[task-resolve-provider] metadata codeChangeRequestOpenedAsDraft added: ${numUpdatedRows} thread(s)`,
    );
    total += Number(numUpdatedRows);
  });

  // The default only backfills existing rows; dropped after so a new row can't silently fall back to GitLab.
  await db.schema
    .alterTable('task_schedules')
    .addColumn('provider', 'text', (col) => col.notNull().defaultTo('gitlab'))
    .execute();
  await db.schema
    .alterTable('task_schedules')
    .alterColumn('provider', (col) => col.dropDefault())
    .execute();
  const { count } = await db
    .selectFrom('task_schedules')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  console.log(
    `[task-resolve-provider] schedule provider set to gitlab: ${count} schedule(s)`,
  );
  total += Number(count);

  console.log(`[task-resolve-provider] done — ${total} row update(s) in total`);
}

// Only drops the column; the added `provider`/`codeChangeRequestOpenedAsDraft` keys match what the old code assumed when absent.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('task_schedules').dropColumn('provider').execute();
}
