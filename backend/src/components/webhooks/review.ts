import type { GitHost, ParsedHarnessConfig } from '#types.js';
import { RunKind } from '#types.js';

import { runsService } from '#components/runs/service.js';
import { threadsDal } from '#components/threads/dal.js';
import {
  enqueueMrReview,
  reviewJobId,
} from '#components/workflows/mr-review/queue.js';

import { config, llms } from '#utils/config.js';
import { shouldReviewBranch } from '#utils/harness-config.js';

const defaultModel = llms.find((m) => m.isDefault)?.model ?? llms[0].model;
const stableBranchRegExp = new RegExp(config.mrReview.stableBranchPattern);

export const reviewThreadMetadata = (
  host: GitHost,
  projectPath: string,
  codeChangeRequestNumber: number,
) => ({
  source: host.provider,
  type: 'code_change_request',
  project: projectPath,
  number: codeChangeRequestNumber,
});

export async function startReviewRun(params: {
  host: GitHost;
  projectPath: string;
  codeChangeRequestNumber: number;
  sourceBranch: string;
  sourceSha: string;
  targetBranch: string;
  defaultBranch: string;
  authorId: number | undefined;
  harnessConfig: ParsedHarnessConfig;
  // A first review jumps the queue; a re-review waits behind them.
  firstReview: boolean;
}) {
  const {
    host,
    projectPath,
    codeChangeRequestNumber,
    sourceBranch,
    sourceSha,
    targetBranch,
    defaultBranch,
    authorId,
    harnessConfig,
    firstReview,
  } = params;

  if (!shouldReviewBranch(harnessConfig.parsed, sourceBranch, targetBranch))
    return {
      received: true,
      status: 'skipped',
      reason: 'branch_excluded_by_config',
    };

  // Skip promotion merges between stable branches (dev → stage, stage → master, etc.)
  if (stableBranchRegExp.test(sourceBranch))
    return {
      received: true,
      status: 'skipped',
      reason: 'stable_branch_promotion',
    };

  const metadata = reviewThreadMetadata(
    host,
    projectPath,
    codeChangeRequestNumber,
  );
  const ref = host.codeChangeRequestRef(String(codeChangeRequestNumber));
  const thread =
    (await threadsDal.findByMetadata(metadata)) ??
    (await threadsDal.insert({
      title: `${projectPath}${ref}`,
      kind: RunKind.MrReview,
      metadata,
    }));

  // A push to a dormant MR reuses its archived thread — revive it so runsService.create doesn't reject the new review.
  if (thread.archived_at) {
    await threadsDal.update(thread.id, { archived_at: null });
  }

  // Remember who opened it so they can abort or retry its review — not whoever triggered this event.
  if (
    authorId !== undefined &&
    thread.metadata?.codeChangeRequestAuthorId == null
  ) {
    await threadsDal.mergeMetadata(thread.id, {
      codeChangeRequestAuthorId: authorId,
    });
  }

  const query = {
    note: `Perform a code review of ${host.codeChangeRequestName} ${ref} in project "${projectPath}".`,
    projectPath,
    codeChangeRequestNumber: String(codeChangeRequestNumber),
    sourceBranch,
    sourceSha,
    targetBranch,
    defaultBranch,
  };
  const runInput = {
    kind: RunKind.MrReview,
    provider: host.provider,
    query,
    model: defaultModel,
    reasoning: config.generation.reasoning,
    config: harnessConfig,
  };
  const run = await runsService.create(thread.id, RunKind.MrReview, runInput);

  await enqueueMrReview(
    reviewJobId(host.provider, query),
    { threadId: thread.id, runId: run.id, ...runInput },
    firstReview ? 0 : undefined,
  );

  // If replaced, enqueueMrReview deletes the orphaned run; if active, it stays QUEUED for the worker's completed handler to re-enqueue.
  return { received: true, status: 'accepted', detail: 'review_enqueued' };
}
