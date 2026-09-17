import { type Kysely, sql } from 'kysely';

import { db as kDb } from '#utils/db.js';

// Backfill the issuer column required by better-auth 1.7.
// Does the full work — column, backfill, NOT NULL, index.
// `runMigrations()` sees everything already exists and is a no-op.

const db = kDb as Kysely<any>;

export async function runbackfill(): Promise<void> {
  // Fresh install — no account table yet. runAuthMigrations() creates it with issuer already correct, so there's nothing here to backfill.
  const tables = await db.introspection.getTables();
  if (!tables.some((t) => t.name === 'account')) {
    console.log('account table does not exist yet — skipping issuer backfill');
    return;
  }

  // 1. Add issuer as nullable with a safe default.
  //    runMigrations() would fail without this on a populated table.
  //    If the column already exists (e.g. manual rerun), ignore.
  try {
    await db.schema
      .alterTable('account')
      .addColumn('issuer', 'text', (col) => col.defaultTo('gitlab'))
      .execute();
    console.log('Added nullable issuer column');
  } catch (e) {
    if (!(e as Error).message?.includes('already exists')) throw e;
    console.log('issuer column already exists — skipping');
  }

  // 2. Backfill existing rows.
  const { numUpdatedRows } = await db
    .updateTable('account')
    .set('issuer', 'gitlab')
    .where('issuer', 'is', null)
    .executeTakeFirst();

  if (numUpdatedRows && numUpdatedRows > 0) {
    console.log(`Backfilled ${numUpdatedRows} account issuer(s)`);
  }

  // 3. Set NOT NULL — already safe after backfill, but `runMigrations()`
  //    would also try this and fail on existing NULLs.
  await sql`ALTER TABLE account ALTER COLUMN issuer SET NOT NULL`.execute(db);

  // 4. Unique compound index — better-auth expects (issuer, accountId).
  await db.schema
    .createIndex('account_issuer_accountId_uidx')
    .ifNotExists()
    .on('account')
    .columns(['issuer', 'accountId'])
    .unique()
    .execute();
}
