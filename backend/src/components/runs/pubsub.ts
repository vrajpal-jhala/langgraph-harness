import { Redis } from 'ioredis';

import type { RunEvent } from '#types.js';
import { RunStatus } from '#types.js';

import { config } from '#utils/config.js';
import { redis } from '#utils/redis.js';

const STREAM_TTL_S = 60;
const STREAM_FIELD = 'e';
const STREAM_END_SENTINEL = 'null';

const streamKey = (runId: string) => `run:${runId}`;
const statusKey = (runId: string) => `run:${runId}:status`;
const errorKey = (runId: string) => `run:${runId}:error`;

export const runPubSub = {
  async init(runId: string): Promise<void> {
    await redis.set(statusKey(runId), RunStatus.RUNNING);
  },

  async publish(runId: string, event: RunEvent): Promise<void> {
    await redis.xadd(
      streamKey(runId),
      '*',
      STREAM_FIELD,
      JSON.stringify(event),
    );
  },

  // Writes the end sentinel, updates status/error, and schedules key expiry.
  async finish(
    runId: string,
    status: RunStatus,
    error?: string | null,
  ): Promise<void> {
    const k = streamKey(runId);
    await redis.set(statusKey(runId), status);
    if (error) await redis.set(errorKey(runId), error);
    await redis.xadd(k, '*', STREAM_FIELD, STREAM_END_SENTINEL);
    await redis.expire(k, STREAM_TTL_S);
    await redis.expire(statusKey(runId), STREAM_TTL_S);
    if (error) await redis.expire(errorKey(runId), STREAM_TTL_S);
  },

  async getStatus(runId: string): Promise<RunStatus | null> {
    const s = await redis.get(statusKey(runId));
    return s as RunStatus | null;
  },

  async getError(runId: string): Promise<string | null> {
    return redis.get(errorKey(runId));
  },

  // Replays all buffered events then tails live ones via XREAD BLOCK.
  // Uses a dedicated connection so the shared client stays unblocked.
  async *stream(runId: string): AsyncGenerator<RunEvent> {
    const client = new Redis(config.redis.url);
    try {
      const k = streamKey(runId);
      let cursor = '0-0'; // read from the beginning for full replay

      while (true) {
        const result = await client.xread('BLOCK', 5000, 'STREAMS', k, cursor);

        if (!result) {
          // Timeout — if the status key is gone the run expired; nothing more to stream.
          const status = await redis.get(statusKey(runId));
          if (!status) return;
          continue;
        }

        for (const [, entries] of result) {
          for (const [id, fields] of entries) {
            cursor = id;
            const data = fields[1]; // value of field 'e'
            if (data === STREAM_END_SENTINEL) return; // end sentinel
            yield JSON.parse(data) as RunEvent;
          }
        }
      }
    } finally {
      await client.quit().catch(() => client.disconnect());
    }
  },
};
