import type { RunEvent, WorktreeEntityType } from '#types.js';
import { RunStep } from '#types.js';

import { repositoriesManager } from '#components/repositories/manager.js';
import { gitService } from '#components/repositories/service.js';

import { config } from '#utils/config.js';

export async function* prepareSandboxedWorktree(params: {
  repo: string;
  entityType: WorktreeEntityType;
  iid: string;
  ref: string;
  sandboxRepoDir: string;
  sandboxWorktreeDir: string;
  signal?: AbortSignal;
}): AsyncGenerator<
  RunEvent,
  {
    worktree: Awaited<ReturnType<typeof repositoriesManager.acquireWorktree>>;
    restoreGitLinks: () => Promise<void>;
  }
> {
  const {
    repo,
    entityType,
    iid,
    ref,
    sandboxRepoDir,
    sandboxWorktreeDir,
    signal,
  } = params;

  const stepId = crypto.randomUUID();
  let error = '';
  let worktree: Awaited<
    ReturnType<typeof repositoriesManager.acquireWorktree>
  > | null = null;

  yield {
    event: 'run_step_start',
    data: { id: stepId, step: RunStep.PrepareWorktree, timestamp: Date.now() },
  };
  try {
    worktree = await repositoriesManager.acquireWorktree({
      repo,
      entityType,
      iid,
      ref,
      detach: false,
      signal,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    yield {
      event: 'run_step_end',
      data: {
        id: stepId,
        step: RunStep.PrepareWorktree,
        repo,
        ref,
        cloned: error || !worktree ? false : worktree.cloned,
        revived: error || !worktree ? false : worktree.revived,
        error,
        retries: worktree?.retries ?? 0,
        maxRetries: config.repositories.worktreeAcquireMaxRetries,
        timestamp: Date.now(),
      },
    };
  }

  const identityStepId = crypto.randomUUID();
  let identityError = '';

  yield {
    event: 'run_step_start',
    data: {
      id: identityStepId,
      step: RunStep.SetGitIdentity,
      timestamp: Date.now(),
    },
  };
  try {
    await gitService.setIdentity(
      worktree.path,
      config.gitlab.commitIdentity.name,
      config.gitlab.commitIdentity.email,
      signal,
    );
  } catch (err) {
    identityError = err instanceof Error ? err.message : String(err);
  } finally {
    yield {
      event: 'run_step_end',
      data: {
        id: identityStepId,
        step: RunStep.SetGitIdentity,
        error: identityError,
        timestamp: Date.now(),
      },
    };
  }

  const restoreGitLinks = await gitService.relocateWorktreeLinks(
    worktree.repoPath,
    worktree.path,
    sandboxRepoDir,
    sandboxWorktreeDir,
  );

  return { worktree, restoreGitLinks };
}

export async function* pushBranch(params: {
  repo: string;
  worktreeRepoPath: string;
  branchName: string;
  expectedSha?: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<RunEvent, void> {
  const { repo, worktreeRepoPath, branchName, expectedSha, signal } = params;

  const stepId = crypto.randomUUID();
  let error = '';
  let forced = false;

  yield {
    event: 'run_step_start',
    data: {
      id: stepId,
      step: RunStep.Push,
      sourceBranch: branchName,
      timestamp: Date.now(),
    },
  };
  try {
    if (!config.mock.workflow) {
      try {
        await gitService.push(
          repo,
          worktreeRepoPath,
          branchName,
          signal,
          undefined,
          expectedSha !== undefined,
        );
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        if (expectedSha === undefined || !text.includes('[rejected]'))
          throw err;
        // A follow-up run may amend its own already-pushed commit on this bot-owned branch.
        forced = true;
        await gitService.push(
          repo,
          worktreeRepoPath,
          branchName,
          signal,
          expectedSha,
        );
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    yield {
      event: 'run_step_end',
      data: {
        id: stepId,
        step: RunStep.Push,
        forced,
        error,
        timestamp: Date.now(),
      },
    };
  }
}

// No commits ahead of defaultBranch → abandon the branch instead of opening an empty MR.
export async function* abandonBranchIfEmpty(params: {
  repo: string;
  worktreeRepoPath: string;
  branchName: string;
  defaultBranch: string;
  entityType: WorktreeEntityType;
  iid: string;
  signal?: AbortSignal;
}): AsyncGenerator<RunEvent, boolean> {
  const {
    repo,
    worktreeRepoPath,
    branchName,
    defaultBranch,
    entityType,
    iid,
    signal,
  } = params;

  const hasChanges = await gitService.hasCommitsAhead(
    worktreeRepoPath,
    defaultBranch,
    branchName,
    signal,
  );
  if (hasChanges) return true;

  const stepId = crypto.randomUUID();
  let error = '';

  yield {
    event: 'run_step_start',
    data: {
      id: stepId,
      step: RunStep.NoChanges,
      branchName,
      timestamp: Date.now(),
    },
  };
  // Best-effort — a cleanup hiccup shouldn't fail an otherwise-successful run.
  try {
    if (!config.mock.workflow) {
      await gitService.deleteRemoteBranch(
        repo,
        worktreeRepoPath,
        branchName,
        signal,
      );
    }
    // Only flags pending_delete — worktree.release() (every caller's own finally) does the actual teardown.
    await repositoriesManager.cleanupWorktree({ repo, entityType, iid });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    yield {
      event: 'run_step_end',
      data: {
        id: stepId,
        step: RunStep.NoChanges,
        error,
        timestamp: Date.now(),
      },
    };
  }

  return false;
}
