import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('threads')
    .ifNotExists()
    .addColumn('id', 'text', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('metadata', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .execute();

  await db.schema
    .createTable('runs')
    .ifNotExists()
    .addColumn('id', 'text', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('thread_id', 'text', (col) =>
      col.notNull().references('threads.id').onDelete('cascade'),
    )
    .addColumn('start_checkpoint_id', 'text')
    .addColumn('end_checkpoint_id', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('running'))
    .addColumn('input', 'jsonb', (col) => col.notNull())
    .addColumn('events', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .execute();

  await sql`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER threads_set_updated_at
      BEFORE UPDATE ON threads
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER runs_set_updated_at
      BEFORE UPDATE ON runs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS runs_set_updated_at ON runs`.execute(db);
  await sql`DROP TRIGGER IF EXISTS threads_set_updated_at ON threads`.execute(
    db,
  );
  await sql`DROP FUNCTION IF EXISTS set_updated_at`.execute(db);
  await db.schema.dropTable('runs').ifExists().execute();
  await db.schema.dropTable('threads').ifExists().execute();
}
