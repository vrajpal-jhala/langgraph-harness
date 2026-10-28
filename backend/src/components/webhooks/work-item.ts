import type { GitHost, ThreadMetadata } from '#types.js';
import { RunKind } from '#types.js';

import { runsService } from '#components/runs/service.js';
import { threadsDal } from '#components/threads/dal.js';
import { enqueueWorkItemResolve } from '#components/workflows/work-item-resolve/queue.js';

import { config, llms } from '#utils/config.js';
import { parseHarnessYml } from '#utils/harness-config.js';

const defaultModel = llms.find((m) => m.isDefault)?.model ?? llms[0].model;

export async function startWorkItemResolveRun(params: {
  host: GitHost;
  projectPath: string;
  issueNumber: string;
  issueKind: 'issue' | 'work_item';
  defaultBranch: string;
  assignedBy: string;
  issueMetadata: ThreadMetadata;
}) {
  const {
    host,
    projectPath,
    issueNumber,
    issueKind,
    defaultBranch,
    assignedBy,
    issueMetadata,
  } = params;

  const thread =
    (await threadsDal.findByMetadata(issueMetadata)) ??
    (await threadsDal.insert({
      title: `${projectPath}#${issueNumber}`,
      kind: RunKind.WorkItemResolve,
      metadata: issueMetadata,
    }));

  if (
    (await runsService.countByThread(thread.id)) >=
    config.workItemResolve.runCap
  ) {
    return { received: true, status: 'skipped', reason: 'run_cap_reached' };
  }

  // Resolved once so a retry replays against the same config the original attempt saw, not whatever's on the default branch by then.
  const harnessConfig = await parseHarnessYml(host, projectPath);

  const workItemResolveInput = {
    kind: RunKind.WorkItemResolve,
    provider: host.provider,
    projectPath,
    issueNumber,
    defaultBranch,
    assignedBy,
    model: defaultModel,
    config: harnessConfig,
    issueKind,
  };
  const run = await runsService.create(
    thread.id,
    RunKind.WorkItemResolve,
    workItemResolveInput,
  );

  const enqueueResult = await enqueueWorkItemResolve({
    threadId: thread.id,
    runId: run.id,
    ...workItemResolveInput,
  });

  return {
    received: true,
    status: 'accepted',
    detail:
      enqueueResult === 'fresh'
        ? 'issue_enqueued'
        : 'issue_enqueued_pending_rerun',
  };
}
