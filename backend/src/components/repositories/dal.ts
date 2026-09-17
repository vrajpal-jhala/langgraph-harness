import { sql } from 'kysely';

import type {
  NewWorktreeLease,
  WorktreeIdentity,
  WorktreeLeaseUpdate,
} from '#types.js';

import { config } from '#utils/config.js';
import { db } from '#utils/db.js';

export const worktreeLeasesDal = {
  findByKey: async ({ repo, entityType, iid }: WorktreeIdentity) => {
    return db
      .selectFrom('worktree_leases')
      .selectAll()
      .where('repo', '=', repo)
      .where('entity_type', '=', entityType)
      .where('iid', '=', iid)
      .executeTakeFirst();
  },

  acquire: async (values: NewWorktreeLease) => {
    return db
      .insertInto('worktree_leases')
      .values(values)
      .onConflict((oc) =>
        oc.columns(['repo', 'entity_type', 'iid']).doUpdateSet((eb) => ({
          ref: eb.ref('excluded.ref'),
          leased: true,
          pending_delete: false,
          accessed_at: sql`NOW()`,
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  release: async (id: string) => {
    return db
      .updateTable('worktree_leases')
      .set({ leased: false })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  },

  update: async (id: string, values: WorktreeLeaseUpdate) => {
    return db
      .updateTable('worktree_leases')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  },

  deleteById: async (id: string) => {
    const result = await db
      .deleteFrom('worktree_leases')
      .where('id', '=', id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  },

  deleteByRepo: async (repo: string) => {
    await db.deleteFrom('worktree_leases').where('repo', '=', repo).execute();
  },

  findStale: async () => {
    return db
      .selectFrom('worktree_leases')
      .selectAll()
      .where('leased', '=', false)
      .where((eb) =>
        eb.or([
          eb('pending_delete', '=', true),
          eb(
            'accessed_at',
            '<',
            sql<Date>`NOW() - (${
              config.repositories.worktreeRetentionMs
            } * INTERVAL '1 millisecond')`,
          ),
        ]),
      )
      .execute();
  },

  getAll: async () => {
    return db.selectFrom('worktree_leases').selectAll().execute();
  },
};
