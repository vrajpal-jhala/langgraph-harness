import { Elysia } from 'elysia';

import type { TaskResolveRunInput, WorkItemResolveRunInput } from '#types.js';
import { RunKind } from '#types.js';

import { analyticsService } from '#components/analytics/service.js';
import { repositoriesManager } from '#components/repositories/manager.js';
import { runsDal } from '#components/runs/dal.js';
import { runsService } from '#components/runs/service.js';
import { threadsDal } from '#components/threads/dal.js';
import { enqueueMrReview } from '#components/workflows/mr-review/queue.js';
import { enqueueTaskResolve } from '#components/workflows/task-resolve/queue.js';
import { enqueueWorkItemResolve } from '#components/workflows/work-item-resolve/queue.js';

import { webhookAuth } from '#utils/auth.js';
import { config, isProjectInScope, llms } from '#utils/config.js';
import { parseHarnessYml, shouldReviewBranch } from '#utils/harness-config.js';
import { logger } from '#utils/logger.js';
import { isAutomatedStatusNote } from '#utils/notes.js';

const defaultModel = llms.find((m) => m.isDefault)?.model ?? llms[0].model;
const stableBranchRegExp = new RegExp(config.mrReview.stableBranchPattern);

// `assignees`, deprecated `assignee`, and `changes.assignees.previous`/`.current` all carry the same { username } shape.
function usernamesFrom(value: unknown): Set<string> {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return new Set(
    entries
      .map((entry) =>
        typeof entry === 'object' && entry !== null
          ? (entry as { username?: string }).username
          : undefined,
      )
      .filter((u): u is string => !!u),
  );
}

// Shared by the Issue Hook (`object_kind: 'issue'`) and Work Item Hook (`'work_item'`, e.g. Tasks) — same field shapes.
async function handleIssueAssignmentEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  issueKind: 'issue' | 'work_item',
) {
  const { object_attributes, project, changes, assignees, assignee, user } =
    body ?? {};
  const issueIid = object_attributes?.iid;
  const projectPath = project?.path_with_namespace;
  const action = object_attributes?.action;

  if (!issueIid || !projectPath || !config.gitlab.username)
    return {
      received: true,
      status: 'skipped',
      reason: 'missing_required_fields',
    };

  if (!isProjectInScope(config.workItemResolve.projectPathFilters, projectPath))
    return {
      received: true,
      status: 'skipped',
      reason: 'project_out_of_scope',
    };

  const issueMetadata = {
    source: 'gitlab',
    type: issueKind,
    project: projectPath,
    iid: issueIid,
  };

  // Fallback for an issue closed with no MR ever opened — once one exists, its own merge/close event owns cleanup instead.
  if (action === 'close') {
    const existingThread = await threadsDal.findByMetadata(issueMetadata);
    if (existingThread?.metadata?.mrIid)
      return {
        received: true,
        status: 'skipped',
        reason: 'mr_owns_lifecycle',
      };

    await repositoriesManager.cleanupWorktree({
      repo: projectPath,
      entityType: 'issue',
      iid: String(issueIid),
    });
    return {
      received: true,
      status: 'accepted',
      detail: 'worktree_cleanup',
    };
  }

  const isAssignmentUpdate = action === 'update' && !!changes?.assignees;
  if (!isAssignmentUpdate && action !== 'open' && action !== 'reopen')
    return {
      received: true,
      status: 'skipped',
      reason: 'not_assignment_event',
    };

  const currentlyAssigned = new Set([
    ...usernamesFrom(assignees),
    ...usernamesFrom(assignee),
  ]).has(config.gitlab.username);

  if (!currentlyAssigned)
    return {
      received: true,
      status: 'skipped',
      reason: 'agent_not_assigned',
    };

  if (isAssignmentUpdate) {
    // Treat an unrecognized previous entry as not-previously-assigned so a real new assignment is never missed.
    const previouslyAssigned = usernamesFrom(changes.assignees.previous).has(
      config.gitlab.username,
    );
    if (previouslyAssigned)
      return {
        received: true,
        status: 'skipped',
        reason: 'already_assigned',
      };
  }

  const thread =
    (await threadsDal.findByMetadata(issueMetadata)) ??
    (await threadsDal.insert({
      title: `${projectPath}#${issueIid}`,
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
  const harnessConfig = await parseHarnessYml(projectPath);

  const workItemResolveInput = {
    kind: RunKind.WorkItemResolve,
    projectPath,
    issueIid: String(issueIid),
    defaultBranch: project?.default_branch ?? '',
    assignedBy: user?.username ?? '',
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

// Epics/Incidents/Test Cases/Requirements/OKRs aren't "write code and open an MR" units of work.
const SUPPORTED_WORK_ITEM_TYPES = new Set(['Task']);

export const webhook = new Elysia({ prefix: '/webhooks' })
  .use(webhookAuth)
  // GitLab webhook payload is an untyped external boundary — no request schema, hence `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .post('/gitlab', async ({ body, set }: { body: any; set: any }) => {
    set.status = 200;

    const {
      object_kind,
      object_attributes,
      project,
      changes,
      merge_request,
      user,
    } = body ?? {};

    if (object_kind === 'issue')
      return handleIssueAssignmentEvent(body, 'issue');

    if (object_kind === 'work_item') {
      const workItemType = object_attributes?.type;
      if (!SUPPORTED_WORK_ITEM_TYPES.has(workItemType))
        return {
          received: true,
          status: 'skipped',
          reason: `unsupported_work_item_type: ${workItemType}`,
        };
      return handleIssueAssignmentEvent(body, 'work_item');
    }

    // Re-fetches live state itself — this payload is only a trigger, never consumed as a snapshot.
    if (object_kind === 'note') {
      const noteableType = object_attributes?.noteable_type;
      const mrIid = merge_request?.iid;
      const projectPath = project?.path_with_namespace;
      const noteId = object_attributes?.id;

      if (
        noteableType !== 'MergeRequest' ||
        object_attributes?.system ||
        !mrIid ||
        !projectPath ||
        !noteId
      )
        return { received: true, status: 'skipped', reason: 'not_mr_comment' };

      const isBotAuthored = user?.username === config.gitlab.username;
      const noteText: string = object_attributes?.note ?? '';

      // Same bot identity as work-item-resolve, so mr-review's own status note would otherwise pass as bot feedback and re-trigger a run on every review pass.
      if (isBotAuthored && isAutomatedStatusNote(noteText))
        return {
          received: true,
          status: 'skipped',
          reason: 'automated_status_note',
        };

      // A human note must tag the bot, or any reviewer aside would re-trigger a run.
      const mentionsBot =
        !!config.gitlab.username &&
        noteText
          .toLowerCase()
          .includes(`@${config.gitlab.username}`.toLowerCase());

      if (!isBotAuthored && !mentionsBot)
        return {
          received: true,
          status: 'skipped',
          reason: 'human_comment_not_tagged',
        };

      const thread = await threadsDal.findByMetadata({
        project: projectPath,
        mrIid: String(mrIid),
      });
      if (!thread)
        return {
          received: true,
          status: 'skipped',
          reason: 'no_matching_work_item_resolve_thread',
        };

      // task-resolve workflow is manually setup so it doesn't need project filters
      if (
        thread.kind === RunKind.WorkItemResolve &&
        !isProjectInScope(
          config.workItemResolve.projectPathFilters,
          projectPath,
        )
      )
        return {
          received: true,
          status: 'skipped',
          reason: 'project_out_of_scope',
        };

      // A blanket bot-username filter would also exclude mr-review's own comments, which must still count.
      const ownNoteIds =
        (thread.metadata?.lastRunReplyNoteIds as string[] | undefined) ?? [];
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
      const harnessConfig = await parseHarnessYml(projectPath);

      if (thread.kind === RunKind.TaskResolve) {
        const { defaultBranch, submittedBy, model } =
          latestRun.input as TaskResolveRunInput;

        // The comment itself is the next instruction — unlike work-item-resolve, which re-reads its issue.
        const taskResolveInput = {
          kind: RunKind.TaskResolve,
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

    if (object_kind !== 'merge_request')
      return {
        received: true,
        status: 'skipped',
        reason: `unhandled_object_kind: ${object_kind}`,
      };

    const action = object_attributes?.action;
    const mrIid = object_attributes?.iid;
    const projectPath = project?.path_with_namespace;

    if (!mrIid || !projectPath)
      return {
        received: true,
        status: 'skipped',
        reason: 'missing_required_fields',
      };

    if (!isProjectInScope(config.mrReview.projectPathFilters, projectPath))
      return {
        received: true,
        status: 'skipped',
        reason: 'project_out_of_scope',
      };

    const mrMetadata = {
      source: 'gitlab',
      type: 'mr',
      project: projectPath,
      iid: mrIid,
    };

    // MR lifecycle end — clean up its worktree, independent of the review flow below. No memories cleanup: mrIid metadata isn't reliably attributable to one MR, and the curator retires stale memories on its own anyway.
    if (action === 'merge' || action === 'close') {
      await repositoriesManager.cleanupWorktree({
        repo: projectPath,
        entityType: 'mr',
        iid: String(mrIid),
      });

      // Merging/closing never closes the issue (no closing keyword, deliberately) — this is the worktree's only cleanup trigger in the common case.
      const workItemResolveThread = await threadsDal.findByMetadata({
        project: projectPath,
        mrIid: String(mrIid),
      });
      // Stored as a raw JSON number from the original webhook payload, not pre-stringified — coerce below.
      const issueIidFromMetadata = workItemResolveThread?.metadata?.iid;
      if (issueIidFromMetadata !== undefined && issueIidFromMetadata !== null) {
        await repositoriesManager.cleanupWorktree({
          repo: projectPath,
          entityType: 'issue',
          iid: String(issueIidFromMetadata),
        });
      }

      // Fire-and-forget — analytics only.
      const thread = await threadsDal.findByMetadata(mrMetadata);
      if (thread) {
        analyticsService
          .recordFinalOwnComments(thread.id, projectPath, String(mrIid))
          .catch((err) =>
            logger.error(
              { err, threadId: thread.id },
              '[analytics] final own_comments check failed',
            ),
          );
      }

      return { received: true, status: 'accepted', detail: 'worktree_cleanup' };
    }

    if (object_attributes?.draft)
      return { received: true, status: 'skipped', reason: 'draft_mr' };

    const isInitial = action === 'open' || action === 'reopen';
    const isReReview = action === 'update' && !!object_attributes?.oldrev;
    // MR marked ready from draft (no new commits, so no oldrev) still needs a first review.
    const isMarkedReady =
      action === 'update' &&
      changes?.draft?.previous === true &&
      changes?.draft?.current === false;

    // Config isn't parsed yet, so this can't check mr_review_requires_harness_reviewer here — the post-parse check below rejects it when that's off.
    const isReviewerUpdate = action === 'update' && !!changes?.reviewers;

    if (!isInitial && !isReReview && !isMarkedReady && !isReviewerUpdate)
      return {
        received: true,
        status: 'skipped',
        reason: 'not_review_trigger',
      };

    const sourceBranch: string = object_attributes?.source_branch ?? '';
    const sourceSha: string = object_attributes?.last_commit?.id ?? '';
    const targetBranch: string = object_attributes?.target_branch ?? '';
    const defaultBranch: string = project?.default_branch ?? '';

    // Resolved once here (never throws) so the workflow's instruction node needn't re-fetch it.
    const harnessConfig = await parseHarnessYml(projectPath);
    const { parsed } = harnessConfig;

    // Reviewer-change-only events were never triggers before this feature.
    if (isReviewerUpdate && !parsed?.mr_review_requires_harness_reviewer)
      return {
        received: true,
        status: 'skipped',
        reason: 'not_review_trigger',
      };

    // Runs before branch filtering so an MR with no bot reviewer short-circuits early.
    if (parsed?.mr_review_requires_harness_reviewer) {
      const currentlyReviewer = new Set([
        ...usernamesFrom(changes?.reviewers?.current),
        ...usernamesFrom(merge_request?.reviewers),
      ]).has(config.gitlab.username);

      if (!currentlyReviewer)
        return {
          received: true,
          status: 'skipped',
          reason: 'not_reviewer_harness',
        };

      // Skip if the bot was already a reviewer before this event.
      if (isReviewerUpdate) {
        const previouslyReviewer = usernamesFrom(
          changes.reviewers.previous,
        ).has(config.gitlab.username);
        if (previouslyReviewer)
          return {
            received: true,
            status: 'skipped',
            reason: 'already_reviewer',
          };
      }
    }

    if (!shouldReviewBranch(parsed, sourceBranch, targetBranch))
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

    const thread =
      (await threadsDal.findByMetadata(mrMetadata)) ??
      (await threadsDal.insert({
        title: `${projectPath}!${mrIid}`,
        kind: RunKind.MrReview,
        metadata: mrMetadata,
      }));

    // A push to a dormant MR reuses its archived thread — revive it so runsService.create doesn't reject the new review.
    if (thread.archived_at) {
      await threadsDal.update(thread.id, { archived_at: null });
    }

    const query = {
      note: `Perform a code review of MR !${mrIid} in project "${projectPath}".`,
      projectId: projectPath,
      mrIid: String(mrIid),
      sourceBranch,
      sourceSha,
      targetBranch,
      defaultBranch,
    };
    const runInput = {
      kind: RunKind.MrReview,
      query,
      model: defaultModel,
      reasoning: false,
      config: harnessConfig,
    };
    const run = await runsService.create(thread.id, RunKind.MrReview, runInput);

    await enqueueMrReview(
      `review:${projectPath}:${mrIid}`,
      { threadId: thread.id, runId: run.id, ...runInput },
      isInitial || isMarkedReady ? 0 : undefined,
    );

    // If replaced, enqueueMrReview deletes the orphaned run; if active, it stays QUEUED for the worker's completed handler to re-enqueue.
    return { received: true, status: 'accepted', detail: 'review_enqueued' };
  });
