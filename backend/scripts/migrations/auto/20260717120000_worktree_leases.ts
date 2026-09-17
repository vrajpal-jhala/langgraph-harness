import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('worktree_leases')
    .ifNotExists()
    .addColumn('id', 'text', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('repo', 'text', (col) => col.notNull())
    .addColumn('entity_type', 'text', (col) => col.notNull())
    .addColumn('iid', 'text', (col) => col.notNull())
    .addColumn('ref', 'text', (col) => col.notNull())
    .addColumn('leased', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('pending_delete', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .addColumn('accessed_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`),
    )
    .addUniqueConstraint('worktree_leases_repo_entity_iid', [
      'repo',
      'entity_type',
      'iid',
    ])
    .execute();

  // Periodic cleanup's only query: released leases past retention.
  await db.schema
    .createIndex('worktree_leases_leased_accessed_at_idx')
    .ifNotExists()
    .on('worktree_leases')
    .columns(['leased', 'accessed_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('worktree_leases_leased_accessed_at_idx')
    .ifExists()
    .execute();
  await db.schema.dropTable('worktree_leases').ifExists().execute();
}
