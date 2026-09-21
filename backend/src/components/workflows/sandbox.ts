import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Sandbox } from '@alibaba-group/opensandbox';

import { config } from '#utils/config.js';

type ProjectType = 'node' | 'python' | 'go';

const PROJECT_MARKERS: [string, ProjectType][] = [
  ['package.json', 'node'],
  ['pyproject.toml', 'python'],
  ['requirements.txt', 'python'],
  ['go.mod', 'go'],
];

const PROJECT_IMAGES: Record<ProjectType, string> = {
  node: 'node:22-bookworm',
  python: 'python:3.12-bookworm',
  go: 'golang:1.23-bookworm',
};

async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

export async function resolveSandboxConfig(
  worktreePath: string,
): Promise<{ image: string }> {
  for (const [marker, type] of PROJECT_MARKERS) {
    if (await pathExists(join(worktreePath, marker))) {
      return { image: PROJECT_IMAGES[type] };
    }
  }

  throw new Error(
    `Unsupported project: no recognized manifest (${PROJECT_MARKERS.map(([m]) => m).join(', ')}) at the repo root.`,
  );
}

export async function createSandbox({
  image,
  volumes,
  signal,
}: {
  image: string;
  volumes: {
    name: string;
    hostPath: string;
    mountPath: string;
    readOnly?: boolean;
  }[];
  signal?: AbortSignal;
}): Promise<Sandbox> {
  return Sandbox.create({
    connectionConfig: {
      domain: config.openSandbox.url,
      apiKey: config.openSandbox.apiKey,
      requestTimeoutSeconds: config.openSandbox.requestTimeoutSeconds,
      useServerProxy: config.openSandbox.useServerProxy,
    },
    image,
    resource: config.openSandbox.resource,
    timeoutSeconds: config.openSandbox.timeoutSeconds,
    volumes: volumes.map((v) => ({
      name: v.name,
      host: { path: v.hostPath },
      mountPath: v.mountPath,
      readOnly: v.readOnly ?? false,
    })),
    signal,
  });
}

// The sandbox always writes as root — skip if the backend is root too (prod), a no-op there.
export async function reclaimSandboxWrites(
  sandbox: Sandbox,
  paths: string[],
): Promise<void> {
  if (process.getuid === undefined || process.getuid() === 0) return;
  try {
    await sandbox.commands.run(
      `chown -R ${process.getuid()}:${process.getgid!()} ${paths.join(' ')}`,
      { timeoutSeconds: 30 },
    );
  } catch {
    // Best-effort — a cleanup hiccup shouldn't fail an otherwise-successful run.
  }
}
