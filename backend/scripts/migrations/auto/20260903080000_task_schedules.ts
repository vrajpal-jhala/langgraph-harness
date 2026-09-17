import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('task_schedules')
    .ifNotExists()
    .addColumn('id', 'text', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('project_path', 'text', (col) => col.notNull())
    .addColumn('prompt', 'text', (col) => col.notNull())
    .addColumn('default_branch', 'text', (col) => col.notNull())
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('recurrence', 'jsonb')
    .addColumn('scheduled_for', 'timestamptz', (col) => col.notNull())
    .addColumn('timezone', 'text', (col) => col.notNull())
    .addColumn('end_date', 'timestamptz')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .execute();

  // The schedules-list page's only query: everything, newest first.
  await db.schema
    .createIndex('task_schedules_created_at_idx')
    .ifNotExists()
    .on('task_schedules')
    .columns(['created_at'])
    .execute();

  // Reuses set_updated_at(), created in the init_schema migration.
  await sql`
    CREATE OR REPLACE TRIGGER task_schedules_set_updated_at
      BEFORE UPDATE ON task_schedules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS task_schedules_set_updated_at ON task_schedules`.execute(
    db,
  );
  await db.schema.dropTable('task_schedules').ifExists().execute();
}
