import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

import { config } from '#utils/config.js';
import { logger } from '#utils/logger.js';

// repo is always "organization/repository" (GitLab's project path_with_namespace).
function remoteUrl(repo: string): string {
  const apiUrl = new URL(config.gitlab.apiUrl);

  return `https://oauth2:${config.gitlab.pat}@${apiUrl.host}/${repo}.git`;
}

// Refs are caller-supplied and passed as bare git argv — a leading "-" could be parsed as an option (e.g. --upload-pack=...), so reject that shape.
function assertSafeRefArg(value: string, label: string): void {
  if (!value || value.startsWith('-')) {
    throw new Error(`unsafe ${label}: ${JSON.stringify(value)}`);
  }
}

// The clone URL embeds the PAT — execa echoes the full argv into err.message/command, so strip it before that error is logged or ever reaches a user-facing field.
function redact(value: string): string {
  return config.gitlab.pat ? value.split(config.gitlab.pat).join('***') : value;
}

function redactError(err: unknown): unknown {
  if (err && typeof err === 'object') {
    for (const key of [
      'message',
      'shortMessage',
      'command',
      'escapedCommand',
    ] as const) {
      const value = (err as Record<string, unknown>)[key];
      if (typeof value === 'string')
        (err as Record<string, unknown>)[key] = redact(value);
    }
  }
  return err;
}

async function git(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  quiet?: boolean,
) {
  try {
    return await execa('git', args, {
      cwd,
      timeout: config.repositories.gitTimeoutMs,
      cancelSignal: signal,
    });
  } catch (err) {
    redactError(err);
    const isCanceled = (err as { isCanceled?: boolean })?.isCanceled === true;
    if (!quiet && !isCanceled)
      logger.error(
        { err, args: args.map(redact), cwd },
        '[git-service] git command failed',
      );

    throw err;
  }
}

export const gitService = {
  version: async () => {
    const { stdout } = await git(['--version'], '.');

    return stdout.trim();
  },

  // path's parent dir must already exist; git creates path itself.
  clone: async (repo: string, path: string, signal?: AbortSignal) => {
    await git(['clone', '--bare', remoteUrl(repo), path], '.', signal);
  },

  // By URL, not the stored `origin` remote — that's frozen with whatever PAT was current at clone time.
  fetch: async (
    repo: string,
    path: string,
    prune?: boolean,
    signal?: AbortSignal,
  ) => {
    await git(
      [
        'fetch',
        // Needed since a non-detached worktree (work-item-resolve's) holds its branch checked out.
        '--update-head-ok',
        remoteUrl(repo),
        '+refs/heads/*:refs/heads/*',
        ...(prune ? ['--prune'] : []),
      ],
      path,
      signal,
    );
  },

  // By URL, not the stored `origin` remote, same reasoning as fetch.
  push: async (
    repo: string,
    path: string,
    ref: string,
    signal?: AbortSignal,
    // leaseSha (undefined = plain push, null = branch must not exist yet) sets an explicit --force-with-lease value.
    leaseSha?: string | null,
    quiet?: boolean,
  ) => {
    assertSafeRefArg(ref, 'ref');
    const lease =
      leaseSha !== undefined
        ? [`--force-with-lease=${ref}:${leaseSha ?? ''}`]
        : [];
    await git(['push', ...lease, remoteUrl(repo), ref], path, signal, quiet);
  },

  // Revives a deleted branch ref locally by pointing it at the still-reachable commit.
  fetchAndTagSha: async (
    repo: string,
    path: string,
    sha: string,
    branch: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(sha, 'sha');
    assertSafeRefArg(branch, 'branch');
    await git(['fetch', remoteUrl(repo), sha], path, signal);
    await git(['update-ref', `refs/heads/${branch}`, sha], path, signal);
  },

  worktreeAdd: async (
    path: string,
    worktreePath: string,
    ref: string,
    detach: boolean,
    signal?: AbortSignal,
    quiet?: boolean,
  ) => {
    assertSafeRefArg(ref, 'ref');
    await git(
      ['worktree', 'add', ...(detach ? ['--detach'] : []), worktreePath, ref],
      path,
      signal,
      quiet,
    );
  },

  createBranch: async (
    path: string,
    name: string,
    baseRef: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(name, 'name');
    assertSafeRefArg(baseRef, 'baseRef');
    await git(['branch', name, baseRef], path, signal);
  },

  hasCommitsAhead: async (
    path: string,
    baseRef: string,
    ref: string,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    assertSafeRefArg(baseRef, 'baseRef');
    assertSafeRefArg(ref, 'ref');
    const { stdout } = await git(
      ['rev-list', '--count', `${baseRef}..${ref}`],
      path,
      signal,
    );
    return Number(stdout.trim()) > 0;
  },

  deleteRemoteBranch: async (
    repo: string,
    path: string,
    name: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(name, 'name');
    await git(['push', remoteUrl(repo), '--delete', name], path, signal);
  },

  listBranches: async (
    path: string,
    pattern: string,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    assertSafeRefArg(pattern, 'pattern');
    // Skips the `*`/`+` marker prefixes plain `branch --list` output has.
    const { stdout } = await git(
      ['branch', '--list', '--format=%(refname:short)', pattern],
      path,
      signal,
    );
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  },

  worktreeRemove: async (path: string, worktreePath: string) => {
    await git(['worktree', 'remove', '--force', worktreePath], path);
  },

  deleteBranch: async (path: string, name: string, signal?: AbortSignal) => {
    assertSafeRefArg(name, 'name');
    try {
      await git(['branch', '-D', name], path, signal, true);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      // Already gone (e.g. a concurrent prune got there first) — nothing to clean up.
      if (text.includes('not found')) return;
      throw err;
    }
  },

  worktreePrune: async (path: string) => {
    await git(['worktree', 'prune'], path);
  },

  worktreeList: async (path: string) => {
    const { stdout } = await git(['worktree', 'list', '--porcelain'], path);
    // Porcelain: each worktree starts a line "worktree /abs/path".
    return [...stdout.matchAll(/^worktree (.+)$/gm)].map((m) => m[1]);
  },

  maintenanceRun: async (path: string) => {
    await git(['maintenance', 'run'], path);
  },

  // `worktree add` bakes the real path into the worktree's `.git` file and the bare repo's matching `worktrees/<name>/gitdir` file — rewrite both for a consumer (e.g. a container) mounting the pair elsewhere. `commondir` is already relative, no rewrite needed. Returns an undo: the worktree is still used from its real path outside that consumer.
  relocateWorktreeLinks: async (
    path: string,
    worktreePath: string,
    newPath: string,
    newWorktreePath: string,
  ): Promise<() => Promise<void>> => {
    const worktreeGitFile = join(worktreePath, '.git');
    const originalWorktreeGit = await readFile(worktreeGitFile, 'utf-8');

    const match = originalWorktreeGit.match(/^gitdir: (.+?)\s*$/);
    if (!match) {
      throw new Error(
        `Unexpected .git file format in worktree at ${worktreePath}`,
      );
    }

    const adminDir = match[1];
    if (!adminDir.startsWith(`${path}/worktrees/`)) {
      throw new Error(
        `Worktree admin dir "${adminDir}" is not under the expected repo path "${path}"`,
      );
    }

    const adminDirName = adminDir.slice(`${path}/worktrees/`.length);
    const gitdirFile = join(path, 'worktrees', adminDirName, 'gitdir');
    const originalGitdirFile = await readFile(gitdirFile, 'utf-8');

    await writeFile(
      worktreeGitFile,
      originalWorktreeGit.replace(path, newPath),
    );
    await writeFile(
      gitdirFile,
      originalGitdirFile.replace(worktreePath, newWorktreePath),
    );

    return async () => {
      await writeFile(worktreeGitFile, originalWorktreeGit);
      await writeFile(gitdirFile, originalGitdirFile);
    };
  },

  setIdentity: async (
    worktreePath: string,
    name: string,
    email: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(name, 'name');
    assertSafeRefArg(email, 'email');
    await git(['config', 'user.name', name], worktreePath, signal);
    await git(['config', 'user.email', email], worktreePath, signal);
  },

  checkout: async (
    worktreePath: string,
    ref: string,
    detach: boolean,
    signal?: AbortSignal,
    quiet?: boolean,
  ) => {
    assertSafeRefArg(ref, 'ref');
    await git(
      ['checkout', ...(detach ? ['--detach'] : []), ref],
      worktreePath,
      signal,
      quiet,
    );
  },

  mergeBase: async (
    worktreePath: string,
    ref: string,
    targetRef: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(ref, 'ref');
    assertSafeRefArg(targetRef, 'targetRef');

    const { stdout } = await git(
      ['merge-base', ref, targetRef],
      worktreePath,
      signal,
    );

    return stdout.trim();
  },

  revParse: async (worktreePath: string, ref: string, signal?: AbortSignal) => {
    assertSafeRefArg(ref, 'ref');
    const { stdout } = await git(['rev-parse', ref], worktreePath, signal);

    return stdout.trim();
  },

  diff: async (
    worktreePath: string,
    base: string,
    head: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(base, 'base');
    assertSafeRefArg(head, 'head');

    const { stdout } = await git(
      ['diff', `${base}...${head}`],
      worktreePath,
      signal,
    );

    return stdout;
  },

  changedFiles: async (
    worktreePath: string,
    base: string,
    head: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(base, 'base');
    assertSafeRefArg(head, 'head');

    const { stdout } = await git(
      ['diff', '--name-status', `${base}...${head}`],
      worktreePath,
      signal,
    );

    return stdout.split('\n').filter(Boolean);
  },

  changedFilePaths: async (
    worktreePath: string,
    base: string,
    head: string,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    const nameStatus = await gitService.changedFiles(
      worktreePath,
      base,
      head,
      signal,
    );

    // Each line is "<status>\t<path>" (rename: "<status>\t<old>\t<new>") — take the final tab segment to get the (new) path.
    return nameStatus.map((line) => line.split('\t').pop() ?? line);
  },

  grep: async (
    worktreePath: string,
    pattern: string,
    pathspec?: string,
    context?: number,
    signal?: AbortSignal,
    fixedStrings?: boolean,
  ) => {
    if (pathspec) assertSafeRefArg(pathspec, 'pathspec');
    const args = ['grep', '-n', '-I'];
    if (fixedStrings) args.push('--fixed-strings');
    args.push('-e', pattern);
    if (context) args.push('-C', String(context));
    if (pathspec) args.push('--', pathspec);

    try {
      const { stdout } = await git(args, worktreePath, signal, true);
      return stdout;
    } catch (err) {
      // git grep exits 1 with no output when there are simply no matches — that's a valid empty result, not a failure.
      if ((err as { exitCode?: number })?.exitCode === 1) return '';
      throw err;
    }
  },

  fileDiff: async (
    worktreePath: string,
    base: string,
    head: string,
    filePath: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(base, 'base');
    assertSafeRefArg(head, 'head');

    const { stdout } = await git(
      ['diff', `${base}...${head}`, '--', filePath],
      worktreePath,
      signal,
    );

    return stdout;
  },

  showFile: async (
    worktreePath: string,
    ref: string,
    filePath: string,
    signal?: AbortSignal,
  ) => {
    assertSafeRefArg(ref, 'ref');

    try {
      const { stdout } = await git(
        ['show', `${ref}:${filePath}`],
        worktreePath,
        signal,
      );

      return stdout;
    } catch (err) {
      const text =
        err instanceof Error
          ? `${err.message} ${(err as { stderr?: string }).stderr ?? ''}`
          : String(err);
      if (text.includes('does not exist') || text.includes('exists on disk')) {
        return null;
      }
      throw err;
    }
  },
};
