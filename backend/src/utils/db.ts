import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Database } from '#types.js';

import { config } from './config.js';

const { Pool } = pg;

const pool = new Pool(config.database);

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export const checkpointer = new PostgresSaver(pool);

export { pool };
