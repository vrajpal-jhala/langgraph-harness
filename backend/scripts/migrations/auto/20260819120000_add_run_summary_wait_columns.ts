import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('run_summaries')
    // Null for runs that never sat in a queue (chat), not 0.
    .addColumn('queue_wait_ms', 'integer')
    .addColumn('llm_backend_wait_ms', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('run_summaries')
    .dropColumn('queue_wait_ms')
    .dropColumn('llm_backend_wait_ms')
    .execute();
}
