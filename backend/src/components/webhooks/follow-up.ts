import type {
  GitHost,
  TaskResolveRunInput,
  Thread,
  WorkItemResolveRunInput,
} from '#types.js';
import { RunKind } from '#types.js';

import { runsDal } from '#components/runs/dal.js';
import { runsService } from '#components/runs/service.js';
import { enqueueTaskResolve } from '#components/workflows/task-resolve/queue.js';
import { enqueueWorkItemResolve } from '#components/workflows/work-item-resolve/queue.js';

import { config, isProjectInScope } from '#utils/config.js';
import { parseHarnessYml } from '#utils/harness-config.js';

// A bare substring would also match `@bot-fan` or `a@bot.com`; usernames on both providers can contain `-`, `_` and `.`.
export function mentionsUser(text: string, username: string): boolean {
  if (!username) return false;
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])@${escaped}(?![\\w-]|\\.\\w)`, 'i').test(text);
}

export async function startFollowUpRun(params: {
  host: GitHost;
  thread: Thread;
  projectPath: string;
  noteId: string | number;
  noteText: string;
}) {
  const { host, thread, projectPath, noteId, noteText } = params;

  // task-resolve workflow is manually setup so it doesn't need project filters
  if (
    thread.kind === RunKind.WorkItemResolve &&
    !isProjectInScope(config.workItemResolve.projectPathFilters, projectPath)
  )
    return {
      received: true,
      status: 'skipped',
      reason: 'project_out_of_scope',
    };

  // A blanket bot-username filter would also exclude mr-review's own comments, which must still count.
  const ownNoteIds =
    (thread.metadata?.lastRunReplyCommentIds as string[] | undefined) ?? [];
  // The GitLab MCP tool returns a posted note's id as a string; the raw webhook payload sends it as a number — compare as strings on both sides.
  if (ownNoteIds.includes(String(noteId)))
    return { received: true, status: 'skipped', reason: 'own_note' };

  const runCap =
    thread.kind === RunKind.TaskResolve
      ? config.taskResolve.runCap
      : config.workItemResolve.runCap;
  if ((await runsService.countByThread(thread.id)) >= runCap) {
    return { received: true, status: 'skipped', reason: 'run_cap_reached' };
  }

  const latestRun = await runsDal.findLatestByThread(thread.id);
  if (!latestRun)
    return { received: true, status: 'skipped', reason: 'no_prior_run' };

  // Fresh parse, not a replay — unlike retry(), which intentionally reuses the original snapshot.
  const harnessConfig = await parseHarnessYml(host, projectPath);

  if (thread.kind === RunKind.TaskResolve) {
    const { defaultBranch, submittedBy, model } =
      latestRun.input as TaskResolveRunInput;

    // The comment itself is the next instruction — unlike work-item-resolve, which re-reads its issue.
    const taskResolveInput = {
      kind: RunKind.TaskResolve,
      provider: host.provider,
      title: thread.title,
      projectPath,
      prompt: noteText,
      defaultBranch,
      submittedBy,
      model,
      config: harnessConfig,
    };

    const run = await runsService.create(
      thread.id,
      RunKind.TaskResolve,
      taskResolveInput,
    );

    const enqueueResult = await enqueueTaskResolve({
      threadId: thread.id,
      runId: run.id,
      ...taskResolveInput,
    });

    return {
      received: true,
      status: 'accepted',
      detail:
        enqueueResult === 'fresh'
          ? 'task_resolve_reenqueued'
          : 'task_resolve_reenqueue_pending',
    };
  }

  const { issueIid, defaultBranch, assignedBy, model, issueKind } =
    latestRun.input as WorkItemResolveRunInput;

  const workItemResolveInput = {
    kind: RunKind.WorkItemResolve,
    provider: host.provider,
    projectPath,
    issueIid,
    defaultBranch,
    assignedBy,
    model,
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
        ? 'work_item_resolve_reenqueued'
        : 'work_item_resolve_reenqueue_pending',
  };
}
