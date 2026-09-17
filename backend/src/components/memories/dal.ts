import { sql } from 'kysely';

import type { MemoryCategory, MemoryUpdate, NewMemory } from '#types.js';

import { db } from '#utils/db.js';

export const memoriesDal = {
  insert: async (values: NewMemory) => {
    const { evidence, ...rest } = values;
    return db
      .insertInto('memories')
      .values({
        ...rest,
        // pg would format a plain array as "{a,b}" (Postgres array), not valid jsonb.
        evidence: sql`${JSON.stringify(evidence)}::jsonb`,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  updateById: async (id: string, values: MemoryUpdate) => {
    const { evidence, ...rest } = values;
    return db
      .updateTable('memories')
      .set({
        ...rest,
        ...(evidence !== undefined && {
          evidence: sql`${JSON.stringify(evidence)}::jsonb`,
        }),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  },

  updateByIdForUser: async (
    id: string,
    userId: string,
    values: MemoryUpdate,
  ) => {
    const { evidence, ...rest } = values;
    return db
      .updateTable('memories')
      .set({
        ...rest,
        ...(evidence !== undefined && {
          evidence: sql`${JSON.stringify(evidence)}::jsonb`,
        }),
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirst();
  },

  deleteById: async (id: string) => {
    const result = await db
      .deleteFrom('memories')
      .where('id', '=', id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  },

  deleteByIdForUser: async (id: string, userId: string) => {
    const result = await db
      .deleteFrom('memories')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  },

  listByProject: async (projectId: string, categories?: MemoryCategory[]) => {
    let query = db
      .selectFrom('memories')
      .selectAll()
      .where('project_id', '=', projectId);

    if (categories?.length) {
      query = query.where('category', 'in', categories);
    }

    return query.orderBy('category').orderBy('updated_at', 'desc').execute();
  },

  listByUser: async (userId: string, categories?: MemoryCategory[]) => {
    let query = db
      .selectFrom('memories')
      .selectAll()
      .where('user_id', '=', userId);

    if (categories?.length) {
      query = query.where('category', 'in', categories);
    }

    return query.orderBy('category').orderBy('updated_at', 'desc').execute();
  },

  countsByProject: async () => {
    return db
      .selectFrom('memories')
      .select(['project_id', sql<number>`count(*)::int`.as('count')])
      .where('project_id', 'is not', null)
      .groupBy('project_id')
      .execute();
  },

  countByUser: async (userId: string) => {
    const row = await db
      .selectFrom('memories')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    return row.count;
  },
};
