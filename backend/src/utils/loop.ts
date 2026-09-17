import { logger } from './logger.js';

// Self-rescheduling (not setInterval) so a run that takes long can't overlap the next tick.
export function createLoop(task: () => Promise<void>, intervalMs: number) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;
  const tick = async () => {
    try {
      await task();
    } catch (err) {
      logger.error({ err }, '[loop] task failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };
  return {
    start: () => {
      if (!stopped) return;
      stopped = false;
      timer = setTimeout(tick, intervalMs);
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
