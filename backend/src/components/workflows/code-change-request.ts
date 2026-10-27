import type { CompletionStatus, GitHost, RunEvent } from '#types.js';
import { RunStep } from '#types.js';

import { config } from '#utils/config.js';

export async function* createDraftCodeChangeRequest(params: {
  host: GitHost;
  projectPath: string;
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
}): AsyncGenerator<RunEvent, { mrIid: string; mrUrl: string; draft: boolean }> {
  const {
    host,
    projectPath,
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
  let draft = true;

  yield {
    event: 'run_step_start',
    data: {
      id: stepId,
      step: RunStep.CreateCodeChangeRequest,
      sourceBranch,
      targetBranch,
      timestamp: Date.now(),
    },
  };
  try {
    if (!config.mock.workflow) {
      if (!existingMrIid) {
        ({ mrIid, mrUrl, draft } = await host.createDraftCodeChangeRequest({
          projectPath,
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
        step: RunStep.CreateCodeChangeRequest,
        codeChangeRequestNumber: mrIid,
        codeChangeRequestUrl: mrUrl,
        error,
        timestamp: Date.now(),
      },
    };
  }

  return { mrIid, mrUrl, draft };
}

export async function* updateCodeChangeRequest(params: {
  host: GitHost;
  projectPath: string;
  mrIid: string;
  description: string;
  draft?: boolean;
  completionStatus: CompletionStatus;
  completionSummary: string;
}): AsyncGenerator<RunEvent, void> {
  const {
    host,
    projectPath,
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
      step: RunStep.UpdateCodeChangeRequest,
      timestamp: Date.now(),
    },
  };
  try {
    if (!config.mock.workflow) {
      await host.updateCodeChangeRequest({
        projectPath,
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
        step: RunStep.UpdateCodeChangeRequest,
        completionStatus,
        completionSummary,
        error,
        timestamp: Date.now(),
      },
    };
  }
}
