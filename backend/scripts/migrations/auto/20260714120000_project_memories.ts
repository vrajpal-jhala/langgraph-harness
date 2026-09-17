import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('project_memories')
    .ifNotExists()
    .addColumn('id', 'text', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('project_id', 'text', (col) => col.notNull())
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('evidence', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('source', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .execute();

  // Every read is "give me this project's memories" (optionally filtered to
  // a few categories) — never a cross-project query.
  await db.schema
    .createIndex('project_memories_project_id_category_idx')
    .ifNotExists()
    .on('project_memories')
    .columns(['project_id', 'category'])
    .execute();

  // Reuses set_updated_at(), created in the init_schema migration.
  await sql`
    CREATE OR REPLACE TRIGGER project_memories_set_updated_at
      BEFORE UPDATE ON project_memories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS project_memories_set_updated_at ON project_memories`.execute(
    db,
  );
  await db.schema
    .dropIndex('project_memories_project_id_category_idx')
    .ifExists()
    .execute();
  await db.schema.dropTable('project_memories').ifExists().execute();
}
