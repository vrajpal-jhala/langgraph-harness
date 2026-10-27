import type { GitProvider } from '#types.js';

import { redis } from '#utils/redis.js';

const DELIVERY_TTL_SECONDS = 24 * 60 * 60;

// Call only after the signature check, or a forged request could claim a real delivery's id before it arrives.
export async function handleOnce<T>(
  provider: GitProvider,
  deliveryId: string | undefined,
  handle: () => Promise<T>,
) {
  if (!deliveryId) return handle();

  const key = `webhook-delivery:${provider}:${deliveryId}`;
  const claimed = await redis.set(key, '1', 'EX', DELIVERY_TTL_SECONDS, 'NX');
  if (!claimed)
    return { received: true, status: 'skipped', reason: 'duplicate_delivery' };

  try {
    return await handle();
  } catch (err) {
    // Released so a manual redeliver of a delivery that failed here can still go through.
    await redis.del(key);
    throw err;
  }
}
