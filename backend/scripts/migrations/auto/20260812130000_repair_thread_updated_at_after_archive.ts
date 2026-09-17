import { type Kysely } from 'kysely';

import { withoutThreadTouchTrigger } from './helpers.js';

// threadsService.archive() used to update threads via the generic update()
// path, which let threads_set_updated_at bump updated_at to the archive
// moment before the archive-specific bypass (dal.ts's archive()) existed.
// Every thread archived before that fix has a stale, inflated updated_at
// holding the archive timestamp instead of its last real activity.
export async function up(db: Kysely<any>): Promise<void> {
  const threads = await db
    .selectFrom('threads')
    .select('id')
    .where('archived_at', 'is not', null)
    .execute();

  await withoutThreadTouchTrigger(db, async () => {
    for (const { id } of threads) {
      const latest = await db
        .selectFrom('runs')
        .select('completed_at')
        .where('thread_id', '=', id)
        .where('completed_at', 'is not', null)
        .orderBy('completed_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!latest?.completed_at) continue; // no recoverable activity timestamp

      // Only ever correct downward — the bug can only have moved updated_at later than reality.
      await db
        .updateTable('threads')
        .set({ updated_at: latest.completed_at })
        .where('id', '=', id)
        .where('updated_at', '>', latest.completed_at)
        .execute();
    }
  });
}

// No db param (unlike migration 1's down) — this migration only ever logs, it never queries.
export async function down(): Promise<void> {
  console.warn(
    '[repair-thread-updated-at-after-archive:down] irreversible — original corrupted values are gone, nothing to restore',
  );
}
