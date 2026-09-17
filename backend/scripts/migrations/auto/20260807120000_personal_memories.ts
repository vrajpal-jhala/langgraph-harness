import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS project_memories_set_updated_at ON project_memories`.execute(
    db,
  );
  await db.schema.alterTable('project_memories').renameTo('memories').execute();
  await db.schema
    .dropIndex('project_memories_project_id_category_idx')
    .ifExists()
    .execute();
  await db.schema
    .createIndex('memories_project_id_category_idx')
    .on('memories')
    .columns(['project_id', 'category'])
    .execute();
  await sql`
    CREATE OR REPLACE TRIGGER memories_set_updated_at
      BEFORE UPDATE ON memories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);

  await db.schema
    .alterTable('memories')
    .alterColumn('project_id', (col) => col.dropNotNull())
    .execute();

  await db.schema.alterTable('memories').addColumn('user_id', 'text').execute();

  await db.schema
    .alterTable('memories')
    .addCheckConstraint(
      'memories_owner_check',
      sql`(project_id IS NULL) <> (user_id IS NULL)`,
    )
    .execute();

  // Personal-memory reads are always "give me this user's memories", same access shape as the project_id/category index.
  await db.schema
    .createIndex('memories_user_id_category_idx')
    .ifNotExists()
    .on('memories')
    .columns(['user_id', 'category'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('memories_user_id_category_idx')
    .ifExists()
    .execute();
  await db.schema
    .alterTable('memories')
    .dropConstraint('memories_owner_check')
    .execute();
  await db.deleteFrom('memories').where('project_id', 'is', null).execute();
  await db.schema.alterTable('memories').dropColumn('user_id').execute();
  await db.schema
    .alterTable('memories')
    .alterColumn('project_id', (col) => col.setNotNull())
    .execute();

  await sql`DROP TRIGGER IF EXISTS memories_set_updated_at ON memories`.execute(
    db,
  );
  await db.schema
    .dropIndex('memories_project_id_category_idx')
    .ifExists()
    .execute();
  await db.schema.alterTable('memories').renameTo('project_memories').execute();
  await db.schema
    .createIndex('project_memories_project_id_category_idx')
    .on('project_memories')
    .columns(['project_id', 'category'])
    .execute();
  await sql`
    CREATE OR REPLACE TRIGGER project_memories_set_updated_at
      BEFORE UPDATE ON project_memories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}
