import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('user_settings')
    .ifNotExists()
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .addPrimaryKeyConstraint('user_settings_pkey', ['user_id', 'key'])
    .execute();

  // Reuses set_updated_at(), created in the init_schema migration.
  await sql`
    CREATE OR REPLACE TRIGGER user_settings_set_updated_at
      BEFORE UPDATE ON user_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS user_settings_set_updated_at ON user_settings`.execute(
    db,
  );
  await db.schema.dropTable('user_settings').ifExists().execute();
}
