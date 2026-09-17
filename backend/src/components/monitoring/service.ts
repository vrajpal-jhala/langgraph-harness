import type { Session } from '#types.js';

import { isAdmin } from '#utils/auth.js';
import { config } from '#utils/config.js';
import { errors } from '#utils/errors.js';

type ContainerStat = {
  name: string;
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  error?: string;
};

type SandboxFleetStats = {
  count: number;
  reachableCount: number;
  cpuUsedPercentageTotal: number;
  memoryUsedMiBTotal: number;
};

type DiskUsageBytes = Record<
  'postgres' | 'redis' | 'supermemory' | 'opensandbox' | 'app',
  number
>;

async function fetchMonitoring<T>(path: string): Promise<T> {
  const res = await fetch(`${config.monitoring.url}${path}`, {
    headers: { 'x-api-key': config.monitoring.apiKey },
  });
  if (!res.ok) throw errors.monitoring.unavailable();
  return res.json() as Promise<T>;
}

export const monitoringService = {
  assertAdmin: (session: Session) => {
    if (!isAdmin(session.username)) throw errors.monitoring.forbidden();
  },

  getStackContainers: () =>
    fetchMonitoring<ContainerStat[]>('/stack-containers'),
  getSandboxFleet: () => fetchMonitoring<SandboxFleetStats>('/sandbox-fleet'),
  getDiskUsage: () => fetchMonitoring<DiskUsageBytes>('/disk-usage'),
};
