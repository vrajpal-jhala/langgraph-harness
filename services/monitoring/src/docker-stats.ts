// Fixed names so this only ever needs the stats endpoint, never inspect/list (which also returns env vars).
const STACK_CONTAINERS = [
  'harness_backend',
  'harness_opensandbox',
  'harness_supermemory',
  'harness_lightpanda',
  'harness_postgres',
  'harness_redis',
] as const;

type ContainerStat = {
  name: string;
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  // Absent container or failed stats call (e.g. `harness_backend` doesn't exist in dev).
  error?: string;
};

interface DockerStatsResponse {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    // cgroup v1 reports page cache as `cache`, v2 as `inactive_file`.
    stats?: { cache?: number; inactive_file?: number };
  };
}

const cpuPercent = (stats: DockerStatsResponse): number => {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    (stats.cpu_stats.system_cpu_usage ?? 0) -
    (stats.precpu_stats.system_cpu_usage ?? 0);
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return (cpuDelta / systemDelta) * (stats.cpu_stats.online_cpus ?? 1) * 100;
};

const emptyStat = (name: string, error: string): ContainerStat => ({
  name,
  cpuPercent: 0,
  memoryUsedBytes: 0,
  memoryLimitBytes: 0,
  error,
});

export async function getStackContainerStats(
  dockerHost: string,
): Promise<ContainerStat[]> {
  const base = dockerHost.replace(/^tcp:/, 'http:');
  return Promise.all(
    STACK_CONTAINERS.map(async (name) => {
      try {
        const res = await fetch(
          `${base}/containers/${name}/stats?stream=false`,
        );
        if (!res.ok) return emptyStat(name, `HTTP ${res.status}`);
        const stats = (await res.json()) as DockerStatsResponse;
        const cache =
          stats.memory_stats.stats?.cache ??
          stats.memory_stats.stats?.inactive_file ??
          0;
        return {
          name,
          cpuPercent: cpuPercent(stats),
          memoryUsedBytes: (stats.memory_stats.usage ?? 0) - cache,
          memoryLimitBytes: stats.memory_stats.limit ?? 0,
        };
      } catch (err) {
        return emptyStat(
          name,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
}
