import { type Kysely, sql } from 'kysely';

import {
  withoutRunTouchTriggers,
  withoutThreadTouchTrigger,
} from './helpers.js';

// Thread metadata keys both providers write, renamed from GitLab's terms. mr-review's `type: 'mr'` and `mrAuthorId` stay GitLab-only for now.
const METADATA_RENAMES = [
  ['mrIid', 'codeChangeRequestNumber'],
  ['mrUrl', 'codeChangeRequestUrl'],
  ['iid', 'number'],
  ['lastRunReplyNoteIds', 'lastRunReplyCommentIds'],
  ['statusNoteId', 'statusCommentId'],
] as const;

// Also moves the sandbox steps to the action-first names every other step uses.
const STEP_RENAMES = [
  ['mr_create', 'create_code_change_request'],
  ['update_merge_request', 'update_code_change_request'],
  ['sandbox_create', 'create_sandbox'],
  ['sandbox_kill', 'kill_sandbox'],
] as const;

// Fields on the create_code_change_request end event, named like the metadata keys.
const STEP_DATA_RENAMES = [
  ['mrIid', 'codeChangeRequestNumber'],
  ['mrUrl', 'codeChangeRequestUrl'],
] as const;

// Everything before GitHub support was GitLab.
const GIT_THREAD_KINDS = ['work_item_resolve', 'task_resolve', 'mr_review'];
const STEP_RUN_KINDS = ['work_item_resolve', 'task_resolve'];

async function renameMetadataKeys(
  db: Kysely<any>,
  renames: readonly (readonly [string, string])[],
): Promise<number> {
  let total = 0;
  for (const [from, to] of renames) {
    const { numUpdatedRows } = await db
      .updateTable('threads')
      .set({
        metadata: sql`(metadata - ${from}::text) || jsonb_build_object(${to}::text, metadata -> ${from}::text)`,
      })
      .where(sql<boolean>`metadata -> ${from}::text IS NOT NULL`)
      .executeTakeFirst();
    console.log(
      `[generalize-provider-keys] metadata ${from} → ${to}: ${numUpdatedRows} thread(s)`,
    );
    total += Number(numUpdatedRows);
  }
  return total;
}

// Rebuilds each events array, changing data.step only on step events — a text replace would also hit tool output that mentions the old value.
async function renameStepValues(
  db: Kysely<any>,
  renames: readonly (readonly [string, string])[],
): Promise<number> {
  let total = 0;
  for (const [from, to] of renames) {
    const isOldStep = (e: ReturnType<typeof sql>) =>
      sql`${e}->>'event' IN ('run_step_start', 'run_step_end') AND ${e}->'data'->>'step' = ${from}`;
    const { numUpdatedRows } = await db
      .updateTable('runs')
      .set({
        events: sql`(
          SELECT jsonb_agg(
            CASE WHEN ${isOldStep(sql`e`)}
              THEN jsonb_set(e, '{data,step}', to_jsonb(${to}::text))
              ELSE e
            END
            ORDER BY ord
          )
          FROM jsonb_array_elements(runs.events) WITH ORDINALITY AS t(e, ord)
        )`,
      })
      .where('kind', 'in', STEP_RUN_KINDS)
      .where(
        sql<boolean>`EXISTS (SELECT 1 FROM jsonb_array_elements(runs.events) AS x(e) WHERE ${isOldStep(sql`e`)})`,
      )
      .executeTakeFirst();
    console.log(
      `[generalize-provider-keys] step ${from} → ${to}: ${numUpdatedRows} run(s)`,
    );
    total += Number(numUpdatedRows);
  }
  return total;
}

async function renameStepDataKeys(
  db: Kysely<any>,
  step: string,
  renames: readonly (readonly [string, string])[],
): Promise<number> {
  let total = 0;
  for (const [from, to] of renames) {
    const hasOldKey = (e: ReturnType<typeof sql>) =>
      sql`${e}->>'event' = 'run_step_end' AND ${e}->'data'->>'step' = ${step} AND ${e}->'data'->${from}::text IS NOT NULL`;
    const { numUpdatedRows } = await db
      .updateTable('runs')
      .set({
        events: sql`(
          SELECT jsonb_agg(
            CASE WHEN ${hasOldKey(sql`e`)}
              THEN jsonb_set(
                e,
                '{data}',
                ((e->'data') - ${from}::text) || jsonb_build_object(${to}::text, e->'data'->${from}::text)
              )
              ELSE e
            END
            ORDER BY ord
          )
          FROM jsonb_array_elements(runs.events) WITH ORDINALITY AS t(e, ord)
        )`,
      })
      .where('kind', 'in', STEP_RUN_KINDS)
      .where(
        sql<boolean>`EXISTS (SELECT 1 FROM jsonb_array_elements(runs.events) AS x(e) WHERE ${hasOldKey(sql`e`)})`,
      )
      .executeTakeFirst();
    console.log(
      `[generalize-provider-keys] ${step} event ${from} → ${to}: ${numUpdatedRows} run(s)`,
    );
    total += Number(numUpdatedRows);
  }
  return total;
}

export async function up(db: Kysely<any>): Promise<void> {
  let total = 0;

  await withoutThreadTouchTrigger(db, async () => {
    total += await renameMetadataKeys(db, METADATA_RENAMES);

    const { numUpdatedRows } = await db
      .updateTable('threads')
      .set({
        metadata: sql`coalesce(metadata, '{}'::jsonb) || '{"source": "gitlab"}'::jsonb`,
      })
      .where('kind', 'in', GIT_THREAD_KINDS)
      .where(sql<boolean>`metadata -> 'source' IS NULL`)
      .executeTakeFirst();
    console.log(
      `[generalize-provider-keys] metadata source added: ${numUpdatedRows} thread(s)`,
    );
    total += Number(numUpdatedRows);

    // Every merge request opened before GitHub's draft fallback was a draft; runs after the rename, which it matches on.
    const { numUpdatedRows: draftRows } = await db
      .updateTable('threads')
      .set({
        metadata: sql`metadata || '{"codeChangeRequestOpenedAsDraft": true}'::jsonb`,
      })
      .where('kind', '=', 'work_item_resolve')
      .where(sql<boolean>`metadata -> 'codeChangeRequestNumber' IS NOT NULL`)
      .where(sql<boolean>`metadata -> 'codeChangeRequestOpenedAsDraft' IS NULL`)
      .executeTakeFirst();
    console.log(
      `[generalize-provider-keys] metadata codeChangeRequestOpenedAsDraft added: ${draftRows} thread(s)`,
    );
    total += Number(draftRows);
  });

  await withoutRunTouchTriggers(db, async () => {
    const { numUpdatedRows } = await db
      .updateTable('runs')
      .set({ input: sql`input || '{"provider": "gitlab"}'::jsonb` })
      .where('kind', '=', 'work_item_resolve')
      .where(sql<boolean>`input -> 'provider' IS NULL`)
      .executeTakeFirst();
    console.log(
      `[generalize-provider-keys] run input provider added: ${numUpdatedRows} run(s)`,
    );
    total += Number(numUpdatedRows);

    total += await renameStepValues(db, STEP_RENAMES);
    total += await renameStepDataKeys(
      db,
      'create_code_change_request',
      STEP_DATA_RENAMES,
    );
  });

  console.log(
    `[generalize-provider-keys] done — ${total} row update(s) in total`,
  );
}

// Reverses the renames only; the added `source`/`provider` match what the old code assumed when they were absent, and the old code never reads `codeChangeRequestOpenedAsDraft`, so they're left in place.
export async function down(db: Kysely<any>): Promise<void> {
  const reversed = <T extends readonly (readonly [string, string])[]>(
    renames: T,
  ) => renames.map(([from, to]) => [to, from] as const);

  await withoutThreadTouchTrigger(db, async () => {
    await renameMetadataKeys(db, reversed(METADATA_RENAMES));
  });
  await withoutRunTouchTriggers(db, async () => {
    await renameStepDataKeys(
      db,
      'create_code_change_request',
      reversed(STEP_DATA_RENAMES),
    );
    await renameStepValues(db, reversed(STEP_RENAMES));
  });
}
