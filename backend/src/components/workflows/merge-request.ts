import type { CompletionStatus, RunEvent } from '#types.js';
import { RunStep } from '#types.js';

import { config } from '#utils/config.js';
import { createDraftMergeRequest, updateMergeRequest } from '#utils/gitlab.js';

export async function* createDraftMr(params: {
  projectId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  reviewerId: number | null;
  // GitLab rejects a second open MR for the same branch pair, so a thread that already has one reuses it instead of creating.
  existingMrIid?: string;
  existingMrUrl?: string;
  mockIid: string;
}): AsyncGenerator<RunEvent, { mrIid: string; mrUrl: string }> {
  const {
    projectId,
    sourceBranch,
    targetBranch,
    title,
    description,
    reviewerId,
    existingMrIid,
    existingMrUrl,
    mockIid,
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
        const mr = await createDraftMergeRequest({
          projectId,
          sourceBranch,
          targetBranch,
          title,
          description,
          reviewerId,
        });
        mrIid = String(mr.iid);
        mrUrl = mr.webUrl;
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
  projectId: string;
  mrIid: string;
  description: string;
  draft?: boolean;
  completionStatus: CompletionStatus;
  completionSummary: string;
}): AsyncGenerator<RunEvent, void> {
  const {
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
      await updateMergeRequest({
        projectId,
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
