import { sql } from 'kysely';

import { db } from '#utils/db.js';

export const authService = {
  getUserCounts: async () => {
    const [{ total, active }] = (
      await sql<{
        total: string;
        active: string;
      }>`
        select
          (select count(*) from "user")::text as total,
          (select count(distinct "userId") from session where "expiresAt" > now())::text as active
      `.execute(db)
    ).rows;

    return { total: Number(total), active: Number(active) };
  },
};
