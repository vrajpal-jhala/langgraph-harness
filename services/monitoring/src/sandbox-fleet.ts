import { Sandbox, SandboxManager } from '@alibaba-group/opensandbox';

type SandboxFleetStats = {
  count: number;
  reachableCount: number;
  cpuUsedPercentageTotal: number;
  memoryUsedMiBTotal: number;
};

export async function getSandboxFleetStats(opts: {
  url: string;
  apiKey: string;
}): Promise<SandboxFleetStats> {
  const connectionConfig = { domain: opts.url, apiKey: opts.apiKey };
  const manager = SandboxManager.create({ connectionConfig });
  try {
    const { items } = await manager.listSandboxInfos({ states: ['Running'] });
    const metrics = await Promise.all(
      items.map(async (info) => {
        try {
          const sandbox = await Sandbox.connect({
            connectionConfig,
            sandboxId: info.id,
          });
          try {
            return await sandbox.getMetrics();
          } finally {
            await sandbox.close();
          }
        } catch (err) {
          console.error(`getMetrics failed for sandbox ${info.id}`, err);
          return null;
        }
      }),
    );
    const reachable = metrics.filter((m) => m !== null);
    return {
      count: items.length,
      reachableCount: reachable.length,
      cpuUsedPercentageTotal: reachable.reduce(
        (sum, m) => sum + m.cpuUsedPercentage,
        0,
      ),
      memoryUsedMiBTotal: reachable.reduce(
        (sum, m) => sum + m.memoryUsedMiB,
        0,
      ),
    };
  } finally {
    await manager.close();
  }
}
