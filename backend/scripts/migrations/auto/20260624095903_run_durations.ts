import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('runs')
    .addColumn('started_at', 'timestamptz')
    .execute();
  await db
    .updateTable('runs')
    .from('threads')
    .set((eb) => ({ started_at: eb.ref('threads.created_at') }))
    .whereRef('runs.thread_id', '=', 'threads.id')
    .where('runs.status', '!=', 'queued')
    .execute();
  await db.schema
    .alterTable('runs')
    .alterColumn('status', (ac) => ac.setDefault('queued'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('runs').dropColumn('started_at').execute();
  await db.schema
    .alterTable('runs')
    .alterColumn('status', (ac) => ac.setDefault('running'))
    .execute();
}
