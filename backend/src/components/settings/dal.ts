import { db } from '#utils/db.js';

export const settingsDal = {
  get: async (userId: string, key: string) => {
    return db
      .selectFrom('user_settings')
      .select('value')
      .where('user_id', '=', userId)
      .where('key', '=', key)
      .executeTakeFirst();
  },

  upsert: async (userId: string, key: string, value: string) => {
    await db
      .insertInto('user_settings')
      .values({ user_id: userId, key, value })
      .onConflict((oc) => oc.columns(['user_id', 'key']).doUpdateSet({ value }))
      .execute();
  },
};
