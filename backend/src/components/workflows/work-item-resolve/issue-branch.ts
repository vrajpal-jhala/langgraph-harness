import type { ModelName, RunEvent } from '#types.js';
import { RunStep } from '#types.js';

import { repositoriesManager } from '#components/repositories/manager.js';
import {
  classifyBranch,
  slugify,
} from '#components/workflows/branch-naming.js';

import { fetchIssue, fetchWorkItem } from '#utils/gitlab.js';

export async function* deriveAndCheckoutBranch(params: {
  repo: string;
  issueIid: string;
  projectId: string;
  defaultBranch: string;
  model: ModelName;
  issueKind: 'issue' | 'work_item';
  signal?: AbortSignal;
}): AsyncGenerator<
  RunEvent,
  {
    branchName: string;
    issue: { title: string; description: string; labels: string[] };
  }
> {
  const { repo, issueIid, projectId, defaultBranch, model, issueKind, signal } =
    params;

  const existingBranches = await repositoriesManager.listBranches({
    repo,
    pattern: `harness/*/${issueIid}-*`,
    signal,
  });

  let branchName = existingBranches[0];
  const issue =
    issueKind === 'work_item'
      ? await fetchWorkItem(projectId, issueIid, signal)
      : await fetchIssue(projectId, issueIid, signal);

  if (!branchName) {
    const labelHint = issue.labels.find((l) => l.startsWith('type::'));

    const { type, slug } = yield* classifyBranch({
      title: issue.title,
      description: issue.description,
      labelHint,
      model,
    });

    branchName = `harness/${type}/${issueIid}-${slugify(slug)}`;

    const createBranchStepId = crypto.randomUUID();
    let createBranchError = '';
    yield {
      event: 'run_step_start',
      data: {
        id: createBranchStepId,
        step: RunStep.CreateBranch,
        branchName,
        timestamp: Date.now(),
      },
    };
    try {
      await repositoriesManager.createBranch({
        repo,
        name: branchName,
        baseRef: defaultBranch,
        signal,
      });
    } catch (err) {
      createBranchError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      yield {
        event: 'run_step_end',
        data: {
          id: createBranchStepId,
          step: RunStep.CreateBranch,
          branchName,
          error: createBranchError,
          timestamp: Date.now(),
        },
      };
    }
  }

  return { branchName, issue };
}
