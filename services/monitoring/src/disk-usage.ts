import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DATA_SUBDIRS = [
  'postgres',
  'redis',
  'supermemory',
  'opensandbox',
  'app',
] as const;

type DiskUsageBytes = Record<(typeof DATA_SUBDIRS)[number], number>;

export async function getDiskUsage(dataPath: string): Promise<DiskUsageBytes> {
  const entries = await Promise.all(
    DATA_SUBDIRS.map(async (dir) => {
      try {
        const { stdout } = await execFileAsync('du', [
          '-sb',
          `${dataPath}/${dir}`,
        ]);
        return [dir, Number(stdout.split(/\s+/)[0])] as const;
      } catch (err) {
        console.error(`du failed for ${dir}`, err);
        return [dir, 0] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as DiskUsageBytes;
}
