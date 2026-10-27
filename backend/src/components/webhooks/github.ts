import { Elysia } from 'elysia';

import { GitProvider } from '#types.js';

import { repositoriesManager } from '#components/repositories/manager.js';
import { threadsDal } from '#components/threads/dal.js';
import { startWorkItemResolveRun } from './work-item.js';

import { githubWebhookAuth } from '#utils/auth.js';
import { config, isProjectInScope } from '#utils/config.js';
import { gitHosts } from '#utils/git-host.js';

type GitHubUser = { login?: string };

const host = gitHosts[GitProvider.GitHub];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleIssuesEvent(body: any) {
  const { action, issue, repository, assignee, sender } = body ?? {};
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
    // Worktree cleanup is the fallback for an issue closed with no PR ever opened — once one exists, its own close event owns it instead.
    if (existingThread?.metadata?.codeChangeRequestNumber)
      return {
        received: true,
        status: 'skipped',
        reason: 'mr_owns_lifecycle',
      };

    await repositoriesManager.cleanupWorktree({
      repo: host.repoKey(projectPath),
      entityType: 'issue',
      iid: String(issueNumber),
    });
    return {
      received: true,
      status: 'accepted',
      detail: 'worktree_cleanup',
    };
  }

  // `assigned` fires once per added assignee, naming only that one — so a match is always a fresh assignment, no previous/current diff needed.
  const isBotAssignment =
    action === 'assigned' &&
    (assignee as GitHubUser | undefined)?.login === config.github.username;
  const isReopenedWithBot =
    action === 'reopened' &&
    ((issue?.assignees ?? []) as GitHubUser[]).some(
      (a) => a.login === config.github.username,
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
    issueIid: String(issueNumber),
    issueKind: 'issue',
    defaultBranch: repository?.default_branch ?? '',
    assignedBy: (sender as GitHubUser | undefined)?.login ?? '',
    issueMetadata,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePullRequestEvent(body: any) {
  const { action, pull_request, repository } = body ?? {};
  const prNumber = pull_request?.number;
  const projectPath: string | undefined = repository?.full_name;

  if (action !== 'closed' || !prNumber || !projectPath)
    return { received: true, status: 'skipped', reason: 'not_pr_close' };

  // Merging/closing never closes the issue (no closing keyword, deliberately) — this is the issue worktree's only cleanup trigger in the common case.
  const thread = await threadsDal.findByMetadata({
    source: GitProvider.GitHub,
    project: projectPath,
    codeChangeRequestNumber: String(prNumber),
  });
  const issueNumber = thread?.metadata?.number;
  if (issueNumber === undefined || issueNumber === null)
    return { received: true, status: 'skipped', reason: 'no_matching_thread' };

  await repositoriesManager.cleanupWorktree({
    repo: host.repoKey(projectPath),
    entityType: 'issue',
    iid: String(issueNumber),
  });
  return { received: true, status: 'accepted', detail: 'worktree_cleanup' };
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
      if (event === 'issues') return handleIssuesEvent(body);
      if (event === 'pull_request') return handlePullRequestEvent(body);

      return {
        received: true,
        status: 'skipped',
        reason: `unhandled_event: ${event}`,
      };
    },
  );
