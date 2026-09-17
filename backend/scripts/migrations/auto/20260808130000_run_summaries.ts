import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('run_summaries')
    .addColumn('run_id', 'text', (col) =>
      col.primaryKey().references('runs.id').onDelete('cascade').notNull(),
    )
    .addColumn('duration_ms', 'integer', (col) => col.notNull())
    .addColumn('success', 'boolean', (col) => col.notNull())
    .addColumn('error_kind', 'text')
    .addColumn('llm_calls', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('tool_calls', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('unique_tools', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('repeated_tool_calls', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('model_retries', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('checkpoints', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('prompt_tokens', 'integer')
    .addColumn('completion_tokens', 'integer')
    .addColumn('total_tokens', 'integer')
    .addColumn('max_context_size', 'integer')
    .addColumn('nudge_stats', 'jsonb', (col) => col.notNull())
    .addColumn('comment_critic', 'jsonb')
    .addColumn('memory_curator', 'jsonb')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('run_summaries').execute();
}
