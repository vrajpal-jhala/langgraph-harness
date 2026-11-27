import { type Kysely, sql } from 'kysely';

import { withoutRunTouchTriggers } from './helpers.js';

const STOP_REASON =
  '^(Merge request|Pull request) (merged|closed)|^Issue closed|^Agent unassigned|^(Stopped|Cancelled) by';

const setCompletedAtOn = (statuses: string) => sql`
  CREATE OR REPLACE FUNCTION set_run_completed_at()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.status IN (${sql.raw(statuses)})
       AND OLD.status IS DISTINCT FROM NEW.status
       AND NEW.completed_at IS NULL THEN
      NEW.completed_at = NOW();
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql
`;

export async function up(db: Kysely<any>): Promise<void> {
  await setCompletedAtOn(
    `'completed', 'failed', 'cancelled', 'interrupted'`,
  ).execute(db);

  let total = 0;
  const log = (label: string, rows: bigint | undefined) => {
    console.log(`[cancelled-runs] ${label}: ${rows ?? 0n} row(s)`);
    total += Number(rows ?? 0n);
  };

  await withoutRunTouchTriggers(db, async () => {
    // Before 1cfda736 every abort was saved as plain "Aborted" — on prod, all checked ones were Stop presses or MR merges.
    const cancelled = await db
      .updateTable('runs')
      .set({ status: 'cancelled' })
      .where('status', '=', 'failed')
      .where((eb) =>
        eb.or([
          sql<boolean>`runs.error ~ ${STOP_REASON}`,
          eb('error', '=', 'Aborted'),
        ]),
      )
      .executeTakeFirst();
    log('runs failed → cancelled', cancelled.numUpdatedRows);
  });

  const cancelledSummaries = await db
    .updateTable('run_summaries')
    .from('runs')
    .set({ error_kind: 'cancelled' })
    .whereRef('runs.id', '=', 'run_summaries.run_id')
    .where('runs.status', '=', 'cancelled')
    .executeTakeFirst();
  log('summaries → cancelled', cancelledSummaries.numUpdatedRows);

  // Repeat-call guard aborts from before they had their own error kind.
  const guardAborts = await db
    .updateTable('run_summaries')
    .from('runs')
    .set({ error_kind: 'guardAbort' })
    .whereRef('runs.id', '=', 'run_summaries.run_id')
    .where('run_summaries.error_kind', '=', 'modelError')
    .where(
      sql<boolean>`runs.error ~ '^Tool \\S+ (was called|failed) with the same arguments'`,
    )
    .executeTakeFirst();
  log('modelError → guardAbort', guardAborts.numUpdatedRows);

  const { count } = await db
    .selectFrom('run_summaries')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('error_kind', '=', 'manualAbort')
    .executeTakeFirstOrThrow();
  console.log(
    `[cancelled-runs] done — ${total} row update(s); ${count} manualAbort summaries left unmatched`,
  );
}

// Guard aborts stay relabelled: that was a mislabel, not something this status introduced.
export async function down(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('run_summaries')
    .set({ error_kind: 'manualAbort' })
    .where('error_kind', '=', 'cancelled')
    .execute();
  await withoutRunTouchTriggers(db, async () => {
    await db
      .updateTable('runs')
      .set({ status: 'failed' })
      .where('status', '=', 'cancelled')
      .execute();
  });
  await setCompletedAtOn(`'completed', 'failed', 'interrupted'`).execute(db);
}
