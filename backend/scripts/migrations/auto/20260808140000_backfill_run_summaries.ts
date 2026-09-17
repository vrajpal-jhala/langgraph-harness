import type { Kysely } from 'kysely';

import type { ErrorKind, RunEvent, RunStatus } from '#types.js';

import { summarizeRun } from '#components/analytics/summarize.js';

// Fixed at authoring time, not computed at rollback time — down() uses this to identify exactly which runs up() touched (everything terminal as of this timestamp), regardless of when down() itself later runs.
const BACKFILL_CUTOFF = '2026-08-08T14:00:00.000Z';

const TERMINAL_STATUSES = ['completed', 'failed', 'interrupted'];

interface RunRow {
  id: string;
  status: RunStatus;
  error: string | null;
  events: RunEvent[];
  started_at: Date | null;
  updated_at: Date;
}

// Historical rows only have the free-text `error` column to go on — live runs record error_kind directly from which catch branch execute() took (runs/service.ts), which this can't see. RunAbortedError (duplicate-call-guard.ts) always ends its message with "Aborting run."; the other three are exact hardcoded strings from runs/service.ts and runsDal.failAllPending().
function classifyErrorKind(
  status: RunStatus,
  error: string | null,
): ErrorKind | undefined {
  if (status !== 'failed' || !error) return undefined;
  if (error === 'Server restarted') return 'serverRestart';
  if (/^Run exceeded the \d+ minute time limit$/.test(error)) return 'timeout';
  if (error === 'Aborted') return 'manualAbort';
  if (error.endsWith('Aborting run.')) return 'guardAbort';
  return 'modelError';
}

export async function up(db: Kysely<any>): Promise<void> {
  const rows = (await db
    .selectFrom('runs')
    .select(['id', 'status', 'error', 'events', 'started_at', 'updated_at'])
    .where('status', 'in', TERMINAL_STATUSES)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('run_summaries')
            .select('run_id')
            .whereRef('run_summaries.run_id', '=', 'runs.id'),
        ),
      ),
    )
    .execute()) as RunRow[];

  console.log(`[backfill-run-summaries] ${rows.length} run(s) to backfill`);

  let done = 0;
  for (const row of rows) {
    const durationMs = row.started_at
      ? row.updated_at.getTime() - row.started_at.getTime()
      : 0;

    // Only the columns run_summaries had at this migration's original run time — summarizeRun() has since grown fields for columns added later.
    const {
      llm_calls,
      tool_calls,
      unique_tools,
      repeated_tool_calls,
      model_retries,
      checkpoints,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      max_context_size,
      nudge_stats,
      comment_critic,
      memory_curator,
    } = summarizeRun(row.events ?? []);

    await db
      .insertInto('run_summaries')
      .values({
        run_id: row.id,
        duration_ms: durationMs,
        success: row.status !== 'failed',
        error_kind: classifyErrorKind(row.status, row.error) ?? null,
        llm_calls,
        tool_calls,
        unique_tools,
        repeated_tool_calls,
        model_retries,
        checkpoints,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        max_context_size,
        nudge_stats,
        comment_critic,
        memory_curator,
      })
      .execute();

    done++;
    if (done % 100 === 0)
      console.log(`[backfill-run-summaries] ${done}/${rows.length}`);
  }

  console.log(`[backfill-run-summaries] done — ${done} row(s) inserted`);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Imprecise by construction (see BACKFILL_CUTOFF) — run_summaries is a pure derived table with no persisted backfill marker, so this identifies "this migration's targets" by the runs' own created_at instead.
  await db
    .deleteFrom('run_summaries')
    .where('run_id', 'in', (eb: any) =>
      eb
        .selectFrom('runs')
        .select('id')
        .where('created_at', '<', BACKFILL_CUTOFF),
    )
    .execute();
}
