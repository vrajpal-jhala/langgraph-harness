import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import type { WorktreeIdentity, WorktreeLease } from '#types.js';

import { worktreeLeasesDal } from './dal.js';
import { gitService } from './service.js';

import { config } from '#utils/config.js';
import { retryWithBackoff } from '#utils/helpers.js';
import { withLock } from '#utils/lock.js';
import { logger } from '#utils/logger.js';
import { createLoop } from '#utils/loop.js';

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// repo/iid come from an untyped webhook payload and get joined into fs paths — reject traversal (e.g. "../../../etc") before path.join.
function assertSafePathSegment(value: string, label: string) {
  if (!value || value === '.' || value === '..' || /[/\\]/.test(value)) {
    throw new Error(`unsafe ${label}: ${JSON.stringify(value)}`);
  }
}

function assertSafeRepo(repo: string) {
  const segments = repo.split('/');
  if (segments.length < 2) {
    throw new Error(`unsafe repo: ${JSON.stringify(repo)}`);
  }
  segments.forEach((s) => assertSafePathSegment(s, 'repo segment'));
}

const reposRoot = join(config.dataPath, 'repositories');
const worktreesRoot = join(config.dataPath, 'worktrees');

const getRepoPath = (repo: string) => join(reposRoot, `${repo}.git`);
const getWorktreePath = ({ repo, entityType, iid }: WorktreeIdentity) =>
  join(worktreesRoot, repo, `${entityType}-${iid}`);

// The lock key and DB natural key for a worktree — the identity, colon-joined.
const worktreeKey = ({ repo, entityType, iid }: WorktreeIdentity) =>
  `${repo}:${entityType}:${iid}`;

// worktree_leases rows use snake_case entity_type — map a row to the camelCase identity.
const rowIdentity = (row: WorktreeLease): WorktreeIdentity => ({
  repo: row.repo,
  entityType: row.entity_type,
  iid: row.iid,
});

// git reports "/" paths even on Windows where join() uses "\" — normalize both before comparing in reconcile().
const toGitPath = (p: string) => p.split(sep).join('/');

async function ensureRepository(repo: string, signal?: AbortSignal) {
  assertSafeRepo(repo);
  const path = getRepoPath(repo);
  if (await pathExists(path)) return { path, cloned: false };

  await mkdir(dirname(path), { recursive: true });
  try {
    await gitService.clone(repo, path, signal);
  } catch (err) {
    // A clone that fails partway still leaves a dir behind — remove it so a retry doesn't mistake it for an already-cloned repo and skip straight to a fetch on a corrupt bare repo.
    await rm(path, { recursive: true, force: true });
    throw err;
  }
  return { path, cloned: true };
}

async function ensureRepositoryWithLock(repo: string, signal?: AbortSignal) {
  return withLock(repo, () => ensureRepository(repo, signal));
}

// Retries `fn` via retryWithBackoff's worktree-acquire policy. `retries` (the number of failed attempts before success) is returned so callers can surface it to the FE — no separate logging here, the FE-visible count already covers it.
async function retryGitOp<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; retries: number }> {
  const { result, attempt } = await retryWithBackoff(fn, {
    maxRetries: config.repositories.worktreeAcquireMaxRetries,
  });
  return { result, retries: attempt };
}

// Must lock through the fetch, not just the clone — else two calls for the same repo race `git fetch` against the same bare repo.
async function fetchRepository(repo: string, signal?: AbortSignal) {
  return withLock(repo, async () => {
    const { result, retries } = await retryGitOp(async () => {
      const { path, cloned } = await ensureRepository(repo, signal);
      if (!cloned)
        // Mock mode never pushes a created branch, so pruning here could delete one still in active use
        await gitService.fetch(repo, path, !config.mock.workflow, signal);
      return { path, cloned };
    });
    return { ...result, retries };
  });
}

// sha fallback for a retry after branch deleted when the MR merged.
async function checkoutWithShaFallback(
  op: () => Promise<void>,
  repo: string,
  barePath: string,
  ref: string,
  sha: string | undefined,
  signal?: AbortSignal,
) {
  try {
    await op();
    // A recreated branch of the same name would resolve here silently to the wrong commit — verify against the known-good sha instead of trusting a bare success.
    if (sha && (await gitService.revParse(barePath, ref, signal)) !== sha) {
      throw new Error(`ref ${ref} resolved to an unexpected commit`);
    }
    return false;
  } catch (err) {
    if (!sha) throw err;
    await gitService.fetchAndTagSha(repo, barePath, sha, ref, signal);
    await op();
    return true;
  }
}

async function teardownWorktree(lease: WorktreeLease) {
  const identity = rowIdentity(lease);
  const barePath = getRepoPath(identity.repo);
  const worktreePath = getWorktreePath(identity);
  if (await pathExists(worktreePath)) {
    await gitService.worktreeRemove(barePath, worktreePath);
  }
  // Nothing else ever deletes a branch ref, so without this they pile up forever. mr-review doesn't own its branch, so it's excluded.
  if (identity.entityType !== 'mr') {
    await gitService.deleteBranch(barePath, lease.ref);
  }
  await worktreeLeasesDal.deleteById(lease.id);
}

const maintenanceLoop = createLoop(
  () => repositoriesManager.maintenance(),
  config.repositories.maintenanceIntervalMs,
);

export const repositoriesManager = {
  // Locked (unlike the bare `ensureRepository` above) so a direct call can't race fetchRepository's own lock on the same repo.
  ensureRepository: ensureRepositoryWithLock,

  fetchRepository,

  acquireWorktree: async (
    params: WorktreeIdentity & {
      ref: string;
      sha?: string;
      detach?: boolean;
      signal?: AbortSignal;
    },
  ) => {
    const { repo, entityType, iid, ref, sha, signal, detach = true } = params;
    assertSafeRepo(repo);
    assertSafePathSegment(iid, 'iid');

    const identity: WorktreeIdentity = { repo, entityType, iid };
    const key = worktreeKey(identity);

    return withLock(key, async () => {
      const {
        path: barePath,
        cloned,
        retries: fetchRetries,
      } = await fetchRepository(repo, signal);

      const worktreePath = getWorktreePath(identity);
      const existing = await worktreeLeasesDal.findByKey(identity);

      let revived: boolean;
      let setupRetries: number;
      if (existing && (await pathExists(worktreePath))) {
        // Shouldn't happen (one reviewer per MR at a time) — fail loud rather than let either release() free it under the other.
        if (existing.leased) {
          throw new Error(
            `worktree ${key} is already leased (checked out to ${existing.ref})`,
          );
        }
        ({ result: revived, retries: setupRetries } = await retryGitOp(() =>
          checkoutWithShaFallback(
            () => gitService.checkout(worktreePath, ref, detach, signal, true),
            repo,
            barePath,
            ref,
            sha,
            signal,
          ),
        ));
      } else {
        if (existing) {
          // Row survived, directory didn't (crash between DB write and worktree creation) — recreate.
          await worktreeLeasesDal.deleteById(existing.id);
        }
        ({ result: revived, retries: setupRetries } = await retryGitOp(
          // Redone on every retry, not just the first — else a failed worktreeAdd leaves a dir behind that trips this same check next attempt.
          async () => {
            // git worktree add refuses a non-empty target — clear a stray dir (crash mid-create, a prior failed attempt, or orphan) and prune first.
            if (await pathExists(worktreePath)) {
              await rm(worktreePath, { recursive: true, force: true });
              await gitService.worktreePrune(barePath);
            }
            await mkdir(dirname(worktreePath), { recursive: true });
            return checkoutWithShaFallback(
              () =>
                gitService.worktreeAdd(
                  barePath,
                  worktreePath,
                  ref,
                  detach,
                  signal,
                  true,
                ),
              repo,
              barePath,
              ref,
              sha,
              signal,
            );
          },
        ));
      }

      const retries = fetchRetries + setupRetries;

      const lease = await worktreeLeasesDal.acquire({
        repo,
        entity_type: entityType,
        iid,
        ref,
        leased: true,
        pending_delete: false,
        accessed_at: new Date(),
      });

      let released = false;
      return {
        path: worktreePath,
        repoPath: barePath,
        cloned,
        revived,
        retries,
        release: async () => {
          if (released) return;
          released = true;

          await withLock(key, async () => {
            const updated = await worktreeLeasesDal.release(lease.id);
            if (updated && !updated.leased && updated.pending_delete) {
              await teardownWorktree(updated);
            }
          });
        },
      };
    });
  },

  createBranch: async (params: {
    repo: string;
    name: string;
    baseRef: string;
    signal?: AbortSignal;
  }): Promise<void> => {
    const { repo, name, baseRef, signal } = params;
    assertSafeRepo(repo);
    const { path: barePath } = await fetchRepository(repo, signal);
    // Locked so a concurrent prune can't delete the branch before it's pushed.
    await withLock(repo, async () => {
      await gitService.createBranch(barePath, name, baseRef, signal);
      if (!config.mock.workflow) {
        await gitService.push(repo, barePath, name, signal);
      }
    });
  },

  listBranches: async (params: {
    repo: string;
    pattern: string;
    signal?: AbortSignal;
  }): Promise<string[]> => {
    const { repo, pattern, signal } = params;
    assertSafeRepo(repo);
    const { path: barePath } = await fetchRepository(repo, signal);
    return gitService.listBranches(barePath, pattern, signal);
  },

  cleanupWorktree: async (identity: WorktreeIdentity) => {
    assertSafeRepo(identity.repo);
    assertSafePathSegment(identity.iid, 'iid');
    const key = worktreeKey(identity);

    await withLock(key, async () => {
      const lease = await worktreeLeasesDal.findByKey(identity);
      if (!lease) return;

      if (!lease.leased) {
        await teardownWorktree(lease);
      } else {
        await worktreeLeasesDal.update(lease.id, { pending_delete: true });
      }
    });
  },

  // Manual/admin only — no automatic eviction yet. Locked per-repo (races an in-flight acquire's per-worktree worktreeAdd).
  cleanupRepository: async (repo: string) => {
    assertSafeRepo(repo);
    await withLock(repo, async () => {
      // rm --force no-ops if the path is already gone.
      await rm(getRepoPath(repo), { recursive: true, force: true });
      await rm(join(worktreesRoot, repo), { recursive: true, force: true });
      // Drop the repo's lease rows too, else they'd dangle until the next startup reconcile.
      await worktreeLeasesDal.deleteByRepo(repo);
    });
  },

  // Removes released worktrees past retention (or pending_delete), then lets git optimize touched repos.
  maintenance: async () => {
    const stale = await worktreeLeasesDal.findStale();
    const touchedRepos = new Set<string>();

    for (const lease of stale) {
      const identity = rowIdentity(lease);
      try {
        await withLock(worktreeKey(identity), async () => {
          // Re-check under the lock — findStale() ran before we held it, so the lease may have been re-acquired since.
          const current = await worktreeLeasesDal.findByKey(identity);
          if (!current || current.leased) return;

          await teardownWorktree(current);
          touchedRepos.add(lease.repo);
        });
      } catch (err) {
        logger.error(
          { err, lease },
          '[repository-manager] failed to remove stale worktree',
        );
      }
    }

    for (const repo of touchedRepos) {
      try {
        // Lock against cleanupRepository so gc can't run on a repo being deleted.
        await withLock(repo, async () => {
          const path = getRepoPath(repo);
          await gitService.worktreePrune(path);
          await gitService.maintenanceRun(path);
        });
      } catch (err) {
        logger.error(
          { err, repo },
          '[repository-manager] repository maintenance failed',
        );
      }
    }
  },

  // Startup: reconcile `git worktree list` (authoritative) against DB rows.
  reconcile: async () => {
    const rows = await worktreeLeasesDal.getAll();
    const rowsByRepo = new Map<string, typeof rows>();
    for (const row of rows) {
      rowsByRepo.set(row.repo, [...(rowsByRepo.get(row.repo) ?? []), row]);
    }

    for (const [repo, repoRows] of rowsByRepo) {
      const repoPath = getRepoPath(repo);

      if (!(await pathExists(repoPath))) {
        for (const row of repoRows) await worktreeLeasesDal.deleteById(row.id);
        continue;
      }

      // First entry is the bare repo's own administrative entry, not a worktree.
      const [, ...liveDirs] = await gitService.worktreeList(repoPath);
      const liveDirSet = new Set(liveDirs.map(toGitPath));
      const rowsWithPaths = repoRows.map((row) => ({
        row,
        worktreePath: toGitPath(getWorktreePath(rowIdentity(row))),
      }));
      const rowPathSet = new Set(
        rowsWithPaths.map(({ worktreePath }) => worktreePath),
      );

      for (const { row, worktreePath } of rowsWithPaths) {
        // Live dir: keep the row but force leased=false (a crash leaves no one to release it).
        if (liveDirSet.has(worktreePath)) {
          await worktreeLeasesDal.update(row.id, { leased: false });
        } else {
          // Dir gone: drop the row, cheap to recreate if needed again.
          await worktreeLeasesDal.deleteById(row.id);
        }
      }

      for (const dir of liveDirSet) {
        if (!rowPathSet.has(dir)) {
          await rm(dir, { recursive: true, force: true }).catch((err) =>
            logger.error(
              { err, dir },
              '[repository-manager] failed to remove orphaned worktree',
            ),
          );
        }
      }

      await gitService.worktreePrune(repoPath);
    }
  },

  healthCheck: async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await gitService.version();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  startMaintenanceLoop: maintenanceLoop.start,

  cleanup: maintenanceLoop.stop,
};
