import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('runs')
    .dropColumn('start_checkpoint_id')
    .execute();
  await db.schema.alterTable('runs').dropColumn('end_checkpoint_id').execute();
  await db.schema
    .alterTable('runs')
    .addColumn('parent_checkpoint_id', 'text')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('runs')
    .dropColumn('parent_checkpoint_id')
    .execute();
  await db.schema
    .alterTable('runs')
    .addColumn('start_checkpoint_id', 'text')
    .execute();
  await db.schema
    .alterTable('runs')
    .addColumn('end_checkpoint_id', 'text')
    .execute();
}
