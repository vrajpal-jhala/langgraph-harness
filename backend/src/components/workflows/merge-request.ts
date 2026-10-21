import type { CompletionStatus, GitProvider, RunEvent } from '#types.js';
import { RunStep } from '#types.js';

import { config } from '#utils/config.js';
import { forgeFor } from '#utils/forge.js';

export async function* createDraftMr(params: {
  provider?: GitProvider;
  projectId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  reviewerUsername: string | null;
  // A second open MR for the same branch pair is rejected on both providers, so a thread that already has one reuses it instead of creating.
  existingMrIid?: string;
  existingMrUrl?: string;
  mockIid: string;
  signal?: AbortSignal;
}): AsyncGenerator<RunEvent, { mrIid: string; mrUrl: string }> {
  const {
    provider,
    projectId,
    sourceBranch,
    targetBranch,
    title,
    description,
    reviewerUsername,
    existingMrIid,
    existingMrUrl,
    mockIid,
    signal,
  } = params;

  const stepId = crypto.randomUUID();
  let error = '';
  let mrIid = existingMrIid ?? '';
  let mrUrl = existingMrUrl ?? '';

  yield {
    event: 'run_step_start',
    data: {
      id: stepId,
      step: RunStep.MrCreate,
      sourceBranch,
      targetBranch,
      timestamp: Date.now(),
    },
  };
  try {
    if (!config.mock.workflow) {
      if (!existingMrIid) {
        ({ mrIid, mrUrl } = await forgeFor(provider).createDraftMr({
          projectPath: projectId,
          sourceBranch,
          targetBranch,
          title,
          description,
          reviewerUsername,
          signal,
        }));
      }
    } else if (!existingMrIid) {
      mrIid = mockIid;
      mrUrl = 'https://mock.invalid/mr';
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    yield {
      event: 'run_step_end',
      data: {
        id: stepId,
        step: RunStep.MrCreate,
        mrIid,
        mrUrl,
        error,
        timestamp: Date.now(),
      },
    };
  }

  return { mrIid, mrUrl };
}

export async function* updateMr(params: {
  provider?: GitProvider;
  projectId: string;
  mrIid: string;
  description: string;
  draft?: boolean;
  completionStatus: CompletionStatus;
  completionSummary: string;
}): AsyncGenerator<RunEvent, void> {
  const {
    provider,
    projectId,
    mrIid,
    description,
    draft,
    completionStatus,
    completionSummary,
  } = params;

  const stepId = crypto.randomUUID();
  let error = '';

  yield {
    event: 'run_step_start',
    data: {
      id: stepId,
      step: RunStep.UpdateMergeRequest,
      timestamp: Date.now(),
    },
  };
  try {
    if (!config.mock.workflow) {
      await forgeFor(provider).updateMr({
        projectPath: projectId,
        mrIid,
        description,
        ...(draft !== undefined && { draft }),
      });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    yield {
      event: 'run_step_end',
      data: {
        id: stepId,
        step: RunStep.UpdateMergeRequest,
        completionStatus,
        completionSummary,
        error,
        timestamp: Date.now(),
      },
    };
  }
}
