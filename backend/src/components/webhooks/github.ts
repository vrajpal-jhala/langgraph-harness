import { Elysia } from 'elysia';

import { GitProvider, RunKind } from '#types.js';

import { analyticsService } from '#components/analytics/service.js';
import { repositoriesManager } from '#components/repositories/manager.js';
import { threadsDal } from '#components/threads/dal.js';
import { threadsService } from '#components/threads/service.js';
import { handleOnce } from './delivery.js';
import { startFollowUpRun } from './follow-up.js';
import {
  recordCodeChangeRequestState,
  reviewThreadMetadata,
  startReviewRun,
} from './review.js';
import { startWorkItemResolveRun } from './work-item.js';

import { githubWebhookAuth } from '#utils/auth.js';
import { config, isProjectInScope } from '#utils/config.js';
import { gitHosts } from '#utils/git-host.js';
import { isStillReviewer } from '#utils/github.js';
import { parseHarnessYml } from '#utils/harness-config.js';
import { mentionsUser } from '#utils/helpers.js';
import { logger } from '#utils/logger.js';
import { isAutomatedStatusNote } from '#utils/notes.js';

type GitHubUser = { login?: string };

const host = gitHosts[GitProvider.GitHub];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleIssuesEvent(body: any) {
  const { action, issue, repository, assignee, sender } = body ?? {};
  const senderLogin = (sender as GitHubUser | undefined)?.login;
  const by = senderLogin ? ` by @${senderLogin}` : '';
  const issueNumber = issue?.number;
  const projectPath: string | undefined = repository?.full_name;

  if (!issueNumber || !projectPath || !config.github.username)
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
    source: GitProvider.GitHub,
    type: 'issue',
    project: projectPath,
    number: issueNumber,
  };

  if (action === 'closed') {
    const existingThread = await threadsDal.findByMetadata(issueMetadata);
    // Otherwise a run already underway still opens or updates a PR for an issue nobody wants anymore.
    if (existingThread)
      await threadsService.stopRuns(existingThread.id, `Issue closed${by}`);

    // Worktree cleanup is the fallback for an issue closed with no PR ever opened — once one exists, its own close event owns it instead.
    if (existingThread?.metadata?.codeChangeRequestNumber)
      return {
        received: true,
        status: 'skipped',
        reason: 'pr_owns_lifecycle',
      };

    await repositoriesManager.cleanupWorktree({
      repo: host.repoKey(projectPath),
      entityType: 'issue',
      entityId: String(issueNumber),
    });
    return {
      received: true,
      status: 'accepted',
      detail: 'worktree_cleanup',
    };
  }

  // `assigned`/`unassigned` fire once per added or removed assignee, naming only that one — so unlike GitLab, no previous/current diff is needed.
  if (
    action === 'unassigned' &&
    (assignee as GitHubUser | undefined)?.login?.toLowerCase() ===
      config.github.username
  ) {
    const existingThread = await threadsDal.findByMetadata(issueMetadata);
    if (!existingThread)
      return {
        received: true,
        status: 'skipped',
        reason: 'no_matching_thread',
      };
    await threadsService.stopRuns(existingThread.id, `Agent unassigned${by}`);
    return { received: true, status: 'accepted', detail: 'runs_stopped' };
  }

  const isBotAssignment =
    action === 'assigned' &&
    (assignee as GitHubUser | undefined)?.login?.toLowerCase() ===
      config.github.username;
  const isReopenedWithBot =
    action === 'reopened' &&
    ((issue?.assignees ?? []) as GitHubUser[]).some(
      (a) => a.login?.toLowerCase() === config.github.username,
    );

  if (!isBotAssignment && !isReopenedWithBot)
    return {
      received: true,
      status: 'skipped',
      reason:
        action === 'assigned' || action === 'reopened'
          ? 'agent_not_assigned'
          : 'not_assignment_event',
    };

  return startWorkItemResolveRun({
    host,
    projectPath,
    issueNumber: String(issueNumber),
    issueKind: 'issue',
    defaultBranch: repository?.default_branch ?? '',
    assignedBy: (sender as GitHubUser | undefined)?.login ?? '',
    issueMetadata,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePullRequestEvent(body: any) {
  const { action, pull_request, repository, requested_reviewer, sender } =
    body ?? {};
  const prNumber = pull_request?.number;
  const projectPath: string | undefined = repository?.full_name;

  if (!prNumber || !projectPath)
    return {
      received: true,
      status: 'skipped',
      reason: 'missing_required_fields',
    };

  const prMetadata = reviewThreadMetadata(host, projectPath, prNumber);

  // PR lifecycle end — clean up its worktree, independent of the review flow below. No memories cleanup: codeChangeRequestNumber metadata isn't reliably attributable to one PR, and the curator retires stale memories on its own anyway.
  if (action === 'closed') {
    const senderLogin = (sender as GitHubUser | undefined)?.login;
    const by = senderLogin ? ` by @${senderLogin}` : '';
    const stopReason = `Pull request ${pull_request.merged ? 'merged' : 'closed'}${by}`;
    // Otherwise a queued or running review still posts on a pull request nobody will merge.
    const thread = await threadsDal.findByMetadata(prMetadata);
    if (thread) await threadsService.stopRuns(thread.id, stopReason);

    await repositoriesManager.cleanupWorktree({
      repo: host.repoKey(projectPath),
      entityType: 'code_change_request',
      entityId: String(prNumber),
    });

    // Merging/closing never closes the issue (no closing keyword, deliberately) — this is the issue worktree's only cleanup trigger in the common case.
    const resolveThread = await threadsDal.findByMetadata({
      source: GitProvider.GitHub,
      project: projectPath,
      codeChangeRequestNumber: String(prNumber),
    });
    // Its worktree is removed below, so a follow-up still running would push to a finished branch.
    if (resolveThread)
      await threadsService.stopRuns(resolveThread.id, stopReason);

    // A task has no issue — its worktree is keyed by the thread instead.
    const target =
      resolveThread?.kind === RunKind.TaskResolve
        ? { entityType: 'task' as const, entityId: resolveThread.id }
        : resolveThread?.metadata?.number != null
          ? {
              entityType: 'issue' as const,
              entityId: String(resolveThread.metadata.number),
            }
          : undefined;

    if (target) {
      await repositoriesManager.cleanupWorktree({
        repo: host.repoKey(projectPath),
        ...target,
      });
    }

    await recordCodeChangeRequestState(
      host,
      projectPath,
      prNumber,
      pull_request.merged ? 'merged' : 'closed',
    );

    // Fire-and-forget — analytics only.
    if (thread) {
      analyticsService
        .recordFinalOwnComments(host, thread.id, projectPath, String(prNumber))
        .catch((err) =>
          logger.error(
            { err, threadId: thread.id },
            '[analytics] final own_comments check failed',
          ),
        );
    }

    return { received: true, status: 'accepted', detail: 'worktree_cleanup' };
  }

  if (!isProjectInScope(config.mrReview.projectPathFilters, projectPath))
    return {
      received: true,
      status: 'skipped',
      reason: 'project_out_of_scope',
    };

  if (pull_request.state !== 'open')
    return { received: true, status: 'skipped', reason: 'pr_not_open' };

  if (pull_request.draft)
    return { received: true, status: 'skipped', reason: 'draft_pr' };

  // The worktree is checked out from the base repo's clone, where a fork's branch doesn't exist — or a same-named base branch would be reviewed instead.
  if (pull_request.head?.repo?.full_name !== projectPath)
    return { received: true, status: 'skipped', reason: 'fork_pr' };

  if (action === 'reopened')
    await recordCodeChangeRequestState(host, projectPath, prNumber, 'opened');

  const isInitial = action === 'opened' || action === 'reopened';
  const isReReview = action === 'synchronize';
  const isMarkedReady = action === 'ready_for_review';
  // Config isn't parsed yet, so this can't check review.requires_reviewer here — the post-parse check below rejects it when that's off.
  const isReviewerRequest = action === 'review_requested';

  if (!isInitial && !isReReview && !isMarkedReady && !isReviewerRequest)
    return {
      received: true,
      status: 'skipped',
      reason: 'not_review_trigger',
    };

  const sourceBranch: string = pull_request.head?.ref ?? '';
  const sourceSha: string = pull_request.head?.sha ?? '';
  const targetBranch: string = pull_request.base?.ref ?? '';
  const defaultBranch: string = repository?.default_branch ?? '';

  // Resolved once here (never throws) so the workflow's instruction node needn't re-fetch it.
  const harnessConfig = await parseHarnessYml(host, projectPath);
  const { parsed } = harnessConfig;

  // Reviewer-request-only events were never triggers before this feature.
  if (isReviewerRequest && !parsed?.review.requires_reviewer)
    return {
      received: true,
      status: 'skipped',
      reason: 'not_review_trigger',
    };

  // Runs before branch filtering so a PR with no bot reviewer short-circuits early.
  if (parsed?.review.requires_reviewer) {
    // Opening with reviewers also sends a separate `review_requested` per reviewer — that one triggers the review, or the PR is reviewed twice.
    if (action === 'opened')
      return {
        received: true,
        status: 'skipped',
        reason: 'review_requested_follows',
      };

    // `review_requested` fires once per added reviewer, naming only that one — so unlike GitLab, no previous/current diff is needed.
    const botRequested = isReviewerRequest
      ? (requested_reviewer as GitHubUser | undefined)?.login?.toLowerCase() ===
        config.github.username
      : ((pull_request.requested_reviewers ?? []) as GitHubUser[]).some(
          (r) => r.login?.toLowerCase() === config.github.username,
        ) ||
        // GitHub drops a reviewer from requested_reviewers once they submit a review, unlike GitLab's reviewers list.
        (await isStillReviewer(projectPath, prNumber, config.github.username));

    if (!botRequested)
      return {
        received: true,
        status: 'skipped',
        reason: 'not_reviewer_harness',
      };
  }

  return startReviewRun({
    host,
    projectPath,
    codeChangeRequestNumber: prNumber,
    sourceBranch,
    sourceSha,
    targetBranch,
    defaultBranch,
    authorId:
      typeof pull_request.user?.id === 'number'
        ? pull_request.user.id
        : undefined,
    harnessConfig,
    firstReview: isInitial || isMarkedReady,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCommentEvent(event: string, body: any) {
  const { action, repository } = body ?? {};
  const isReview = event === 'pull_request_review';
  // A review's summary arrives apart from its line comments, which come as `pull_request_review_comment`.
  const comment = isReview ? body?.review : body?.comment;
  // A PR's conversation comments arrive as `issue_comment`, shared with plain issues; only the ones on a PR can have a follow-up.
  const pr =
    event === 'issue_comment'
      ? body?.issue?.pull_request
        ? body.issue
        : undefined
      : body?.pull_request;
  const prNumber = pr?.number;
  const projectPath: string | undefined = repository?.full_name;
  const noteId = comment?.id;

  if (
    action !== (isReview ? 'submitted' : 'created') ||
    !prNumber ||
    !projectPath ||
    !noteId ||
    !config.github.username
  )
    return { received: true, status: 'skipped', reason: 'not_pr_comment' };

  // Its worktree is already cleaned up, so a run would recreate it and push to a finished branch.
  if (pr.state !== 'open')
    return {
      received: true,
      status: 'skipped',
      reason: 'pr_not_open',
    };

  const botUsername = config.github.username;
  const isBotAuthored =
    ((comment.user as GitHubUser | undefined)?.login ?? '').toLowerCase() ===
    botUsername;
  const noteText: string = comment.body ?? '';

  // GitHub wraps every line comment in a review, so each one also arrives here with no summary — including the bot's own replies, whose review id isn't among its reply ids.
  if (isReview && !noteText.trim())
    return { received: true, status: 'skipped', reason: 'empty_pr_review' };

  // Same bot identity as the issue-resolve status comment, which would otherwise pass as bot feedback and re-trigger a run on every update.
  if (isBotAuthored && isAutomatedStatusNote(noteText))
    return {
      received: true,
      status: 'skipped',
      reason: 'automated_status_note',
    };

  // A human comment must tag the bot, or any reviewer aside would re-trigger a run.
  if (!isBotAuthored && !mentionsUser(noteText, config.github.username))
    return {
      received: true,
      status: 'skipped',
      reason: 'human_comment_not_tagged',
    };

  const thread =
    (await threadsDal.findByMetadata({
      source: GitProvider.GitHub,
      project: projectPath,
      codeChangeRequestNumber: String(prNumber),
    })) ??
    // A review posts many comments of its own, so only a person tagging the bot reaches its review thread.
    (isBotAuthored
      ? undefined
      : await threadsDal.findByMetadata(
          reviewThreadMetadata(host, projectPath, prNumber),
        ));
  if (!thread)
    return {
      received: true,
      status: 'skipped',
      reason: 'no_matching_pr_thread',
    };

  return startFollowUpRun({ host, thread, projectPath, noteId, noteText });
}

export const githubWebhook = new Elysia({ prefix: '/webhooks' })
  .use(githubWebhookAuth)
  // GitHub webhook payload is an untyped external boundary — no request schema, hence `any`.
  .post(
    '/github',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ body, headers, set }: { body: any; headers: any; set: any }) => {
      set.status = 200;

      // GitHub has no `object_kind` — the event type only arrives as this header.
      const event = headers['x-github-event'];

      if (event === 'ping')
        return { received: true, status: 'accepted', detail: 'pong' };

      return handleOnce(
        GitProvider.GitHub,
        headers['x-github-delivery'],
        async () => {
          if (event === 'issues') return handleIssuesEvent(body);
          if (event === 'pull_request') return handlePullRequestEvent(body);
          if (
            event === 'issue_comment' ||
            event === 'pull_request_review_comment' ||
            event === 'pull_request_review'
          )
            return handleCommentEvent(event, body);

          return {
            received: true,
            status: 'skipped',
            reason: `unhandled_event: ${event}`,
          };
        },
      );
    },
  );
