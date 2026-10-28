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
  existingCodeChangeRequestNumber?: string;
  existingCodeChangeRequestUrl?: string;
  mockNumber: string;
  signal?: AbortSignal;
}): AsyncGenerator<
  RunEvent,
  {
    codeChangeRequestNumber: string;
    codeChangeRequestUrl: string;
    draft: boolean;
  }
> {
  const {
    host,
    projectPath,
    sourceBranch,
    targetBranch,
    title,
    description,
    reviewerUsername,
    existingCodeChangeRequestNumber,
    existingCodeChangeRequestUrl,
    mockNumber,
    signal,
  } = params;

  const stepId = crypto.randomUUID();
  let error = '';
  let codeChangeRequestNumber = existingCodeChangeRequestNumber ?? '';
  let codeChangeRequestUrl = existingCodeChangeRequestUrl ?? '';
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
      if (!existingCodeChangeRequestNumber) {
        ({ codeChangeRequestNumber, codeChangeRequestUrl, draft } =
          await host.createDraftCodeChangeRequest({
            projectPath,
            sourceBranch,
            targetBranch,
            title,
            description,
            reviewerUsername,
            signal,
          }));
      }
    } else if (!existingCodeChangeRequestNumber) {
      codeChangeRequestNumber = mockNumber;
      codeChangeRequestUrl = 'https://mock.invalid/code-change-request';
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
        codeChangeRequestNumber: codeChangeRequestNumber,
        codeChangeRequestUrl: codeChangeRequestUrl,
        error,
        timestamp: Date.now(),
      },
    };
  }

  return { codeChangeRequestNumber, codeChangeRequestUrl, draft };
}

export async function* updateCodeChangeRequest(params: {
  host: GitHost;
  projectPath: string;
  codeChangeRequestNumber: string;
  description: string;
  draft?: boolean;
  completionStatus: CompletionStatus;
  completionSummary: string;
}): AsyncGenerator<RunEvent, void> {
  const {
    host,
    projectPath,
    codeChangeRequestNumber,
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
        codeChangeRequestNumber,
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
