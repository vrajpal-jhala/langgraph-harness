import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getMigrations } from 'better-auth/db/migration';
import { FileMigrationProvider, Migrator } from 'kysely/migration';

import { auth } from '#components/auth/index.js';
import { runbackfill } from './migrations/manual/20260823120000_better_auth_issuer_backfill.js';

import { checkpointer, db } from '#utils/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(__dirname, 'migrations', 'auto'),
    import: (filePath) => import(pathToFileURL(filePath).href), // Fixes Windows ESM pathing
  }),
});

const command = process.argv[2] ?? 'up';

if (command === 'up') {
  // 1. Auto-migrations (Kysely-gated via migration log table).
  //    These run only when a new file is discovered — once per file.

  const { error, results } = await migrator.migrateToLatest();
  results?.forEach((r) => {
    if (r.status === 'Success') console.log(`✓ ${r.migrationName}`);
    else if (r.status === 'Error') console.error(`✗ ${r.migrationName}`);
  });
  if (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }

  // 1.5 Better-auth issuer column backfill.
  await runbackfill();

  // 2. Unconditional schema sync: always compares current schema to DB
  //    state, so it's safe to run every deploy (no-op when everything
  //    is in sync).
  //    These always run regardless of whether auto-migrations ran.

  // better-auth schema (tables, columns, indexes)
  const { runMigrations: runAuthMigrations } = await getMigrations(
    auth.options,
  );
  await runAuthMigrations();

  // LangGraph checkpoint tables
  await checkpointer.setup();
} else if (command === 'down') {
  // better-auth and LangGraph tables are left alone: they belong to no migration, and dropping them would delete every account and run checkpoint.
  const { error, results } = await migrator.migrateDown();
  results?.forEach((r) => {
    if (r.status === 'Success') console.log(`✓ rolled back ${r.migrationName}`);
    else if (r.status === 'Error') console.error(`✗ ${r.migrationName}`);
  });
  if (error) {
    console.error('Migration rollback failed:', error);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}. Use "up" or "down".`);
  process.exit(1);
}

await db.destroy();
