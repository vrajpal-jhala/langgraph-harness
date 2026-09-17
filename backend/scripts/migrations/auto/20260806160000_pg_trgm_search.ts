import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS threads_title_trgm_idx ON threads USING gin (title gin_trgm_ops)`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS threads_title_trgm_idx`.execute(db);
  console.log(
    '[pg-trgm-search:down] left pg_trgm extension installed — other objects may come to rely on it',
  );
}
