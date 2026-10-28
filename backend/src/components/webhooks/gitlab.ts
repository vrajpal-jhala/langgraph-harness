import { Elysia } from 'elysia';

import { GitProvider, RunKind } from '#types.js';

import { analyticsService } from '#components/analytics/service.js';
import { repositoriesManager } from '#components/repositories/manager.js';
import { runsService } from '#components/runs/service.js';
import { threadsDal } from '#components/threads/dal.js';
import { threadsService } from '#components/threads/service.js';
import { enqueueMrReview } from '#components/workflows/mr-review/queue.js';
import { handleOnce } from './delivery.js';
import { mentionsUser, startFollowUpRun } from './follow-up.js';
import { startWorkItemResolveRun } from './work-item.js';

import { gitlabWebhookAuth } from '#utils/auth.js';
import { config, isProjectInScope, llms } from '#utils/config.js';
import { gitHosts } from '#utils/git-host.js';
import { parseHarnessYml, shouldReviewBranch } from '#utils/harness-config.js';
import { logger } from '#utils/logger.js';
import { isAutomatedStatusNote } from '#utils/notes.js';

const defaultModel = llms.find((m) => m.isDefault)?.model ?? llms[0].model;
const stableBranchRegExp = new RegExp(config.mrReview.stableBranchPattern);
const host = gitHosts[GitProvider.GitLab];

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
    source: GitProvider.GitLab,
    type: issueKind,
    project: projectPath,
    number: issueIid,
  };

  if (action === 'close') {
    const existingThread = await threadsDal.findByMetadata(issueMetadata);
    // Otherwise a run already underway still opens or updates an MR for an issue nobody wants anymore.
    if (existingThread) await threadsService.stopRuns(existingThread.id);

    // Worktree cleanup is the fallback for an issue closed with no MR ever opened — once one exists, its own merge/close event owns it instead.
    if (existingThread?.metadata?.codeChangeRequestNumber)
      return {
        received: true,
        status: 'skipped',
        reason: 'mr_owns_lifecycle',
      };

    await repositoriesManager.cleanupWorktree({
      repo: host.repoKey(projectPath),
      entityType: 'issue',
      entityId: String(issueIid),
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

  if (
    isAssignmentUpdate &&
    usernamesFrom(changes.assignees.previous).has(config.gitlab.username) &&
    !usernamesFrom(changes.assignees.current).has(config.gitlab.username)
  ) {
    const existingThread = await threadsDal.findByMetadata(issueMetadata);
    if (!existingThread)
      return {
        received: true,
        status: 'skipped',
        reason: 'no_matching_thread',
      };
    await threadsService.stopRuns(existingThread.id);
    return { received: true, status: 'accepted', detail: 'runs_stopped' };
  }

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

  return startWorkItemResolveRun({
    host,
    projectPath,
    issueNumber: String(issueIid),
    issueKind,
    defaultBranch: project?.default_branch ?? '',
    assignedBy: user?.username ?? '',
    issueMetadata,
  });
}

// Re-fetches live state itself — this payload is only a trigger, never consumed as a snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleNoteEvent(body: any) {
  const { object_attributes, project, merge_request, user } = body ?? {};

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
  if (!isBotAuthored && !mentionsUser(noteText, config.gitlab.username))
    return {
      received: true,
      status: 'skipped',
      reason: 'human_comment_not_tagged',
    };

  const thread = await threadsDal.findByMetadata({
    source: GitProvider.GitLab,
    project: projectPath,
    codeChangeRequestNumber: String(mrIid),
  });
  if (!thread)
    return {
      received: true,
      status: 'skipped',
      reason: 'no_matching_work_item_resolve_thread',
    };

  return startFollowUpRun({ host, thread, projectPath, noteId, noteText });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMergeRequestEvent(body: any) {
  const { object_attributes, project, changes, reviewers } = body ?? {};

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
    source: GitProvider.GitLab,
    type: 'mr',
    project: projectPath,
    number: mrIid,
  };

  // MR lifecycle end — clean up its worktree, independent of the review flow below. No memories cleanup: mrIid metadata isn't reliably attributable to one MR, and the curator retires stale memories on its own anyway.
  if (action === 'merge' || action === 'close') {
    await repositoriesManager.cleanupWorktree({
      repo: host.repoKey(projectPath),
      entityType: 'mr',
      entityId: String(mrIid),
    });

    // Merging/closing never closes the issue (no closing keyword, deliberately) — this is the worktree's only cleanup trigger in the common case.
    const resolveThread = await threadsDal.findByMetadata({
      source: GitProvider.GitLab,
      project: projectPath,
      codeChangeRequestNumber: String(mrIid),
    });
    // Stored as a raw JSON number from the original webhook payload, not pre-stringified — coerce below.
    const issueIidFromMetadata = resolveThread?.metadata?.number;
    if (issueIidFromMetadata !== undefined && issueIidFromMetadata !== null) {
      await repositoriesManager.cleanupWorktree({
        repo: host.repoKey(projectPath),
        entityType: 'issue',
        entityId: String(issueIidFromMetadata),
      });
    }

    // A task has no issue — its worktree is keyed by the thread instead.
    if (resolveThread?.kind === RunKind.TaskResolve) {
      await repositoriesManager.cleanupWorktree({
        repo: host.repoKey(projectPath),
        entityType: 'task',
        entityId: resolveThread.id,
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
  const harnessConfig = await parseHarnessYml(host, projectPath);
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
      ...usernamesFrom(reviewers),
    ]).has(config.gitlab.username);

    if (!currentlyReviewer)
      return {
        received: true,
        status: 'skipped',
        reason: 'not_reviewer_harness',
      };

    // Skip if the bot was already a reviewer before this event.
    if (isReviewerUpdate) {
      const previouslyReviewer = usernamesFrom(changes.reviewers.previous).has(
        config.gitlab.username,
      );
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

  // Remember who opened the MR so they can abort or retry its review. Not the top-level `user`, which is whoever triggered this event.
  const authorId = object_attributes?.author_id;
  if (typeof authorId === 'number' && thread.metadata?.mrAuthorId == null) {
    await threadsDal.mergeMetadata(thread.id, { mrAuthorId: authorId });
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
    reasoning: config.generation.reasoning,
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
}

// Epics/Incidents/Test Cases/Requirements/OKRs aren't "write code and open an MR" units of work.
const SUPPORTED_WORK_ITEM_TYPES = new Set(['Task']);

export const gitlabWebhook = new Elysia({ prefix: '/webhooks' })
  .use(gitlabWebhookAuth)
  // GitLab webhook payload is an untyped external boundary — no request schema, hence `any`.
  .post(
    '/gitlab',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ body, headers, set }: { body: any; headers: any; set: any }) => {
      set.status = 200;

      return handleOnce(
        GitProvider.GitLab,
        headers['idempotency-key'],
        async () => {
          const { object_kind, object_attributes } = body ?? {};

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

          if (object_kind === 'note') return handleNoteEvent(body);
          if (object_kind === 'merge_request')
            return handleMergeRequestEvent(body);

          return {
            received: true,
            status: 'skipped',
            reason: `unhandled_object_kind: ${object_kind}`,
          };
        },
      );
    },
  );
