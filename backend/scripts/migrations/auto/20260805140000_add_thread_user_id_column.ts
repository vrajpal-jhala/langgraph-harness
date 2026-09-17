import { type Kysely } from 'kysely';

// Promotes metadata.user_id (JSONB) to a real column — same rationale as runs.kind/threads.kind.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('threads').addColumn('user_id', 'text').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('threads').dropColumn('user_id').execute();
}
