import { config } from './config.js';
import { errors, isNotFoundApiError } from './errors.js';
import { logger } from './logger.js';

const GITHUB_FETCH_TIMEOUT_MS = 15_000;

interface GitHubFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

// Same timeout/abort contract as gitlabFetch: pass parentSignal only for reads.
async function githubFetch(
  path: string,
  opts?: GitHubFetchOptions,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () =>
      controller.abort(
        new DOMException('GitHub request timed out', 'TimeoutError'),
      ),
    GITHUB_FETCH_TIMEOUT_MS,
  );
  const onParentAbort = () => controller.abort(parentSignal!.reason);
  // An 'abort' listener never fires for a signal that was already aborted.
  if (parentSignal?.aborted) onParentAbort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const res = await fetch(
      path.startsWith('https://') ? path : `${config.github.apiUrl}${path}`,
      {
        ...opts,
        headers: {
          Authorization: `Bearer ${config.github.pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
          ...opts?.headers,
        },
        signal: controller.signal,
      },
    );
    if (!res.ok)
      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    return res;
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

// GitHub Enterprise serves GraphQL at /api/graphql, beside REST's /api/v3 — not under it.
const graphqlUrl = config.github.apiUrl.replace(/\/v3\/?$/, '') + '/graphql';

const repoPath = (projectPath: string) =>
  `/repos/${projectPath.split('/').map(encodeURIComponent).join('/')}`;

export async function fetchIssue(
  projectPath: string,
  issueNumber: string,
  signal?: AbortSignal,
): Promise<{ title: string; description: string; labels: string[] }> {
  const res = await githubFetch(
    `${repoPath(projectPath)}/issues/${issueNumber}`,
    undefined,
    signal,
  );
  const data = (await res.json()) as {
    title: string;
    body: string | null;
    labels: { name: string }[];
  };
  return {
    title: data.title,
    description: data.body ?? '',
    labels: data.labels.map((l) => l.name),
  };
}

export async function fetchRepoFile(
  projectPath: string,
  path: string,
): Promise<string | null> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  try {
    const res = await githubFetch(
      `${repoPath(projectPath)}/contents/${encodedPath}`,
      { headers: { Accept: 'application/vnd.github.raw+json' } },
    );
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('GitHub API error 404'))
      return null;
    throw err;
  }
}

export async function resolveRepo(
  urlPath: string,
  signal?: AbortSignal,
): Promise<{ projectPath: string; defaultBranch: string }> {
  // Repos are always owner/repo, so anything after is a UI route like /tree/main.
  const [owner, repo] = urlPath.split('/');
  if (!owner || !repo) {
    throw errors.taskResolve.invalidRepo(
      `URL is not a repository path: ${urlPath}`,
    );
  }
  // A private repo the bot can't see is indistinguishable from one that doesn't exist — GitHub 404s both.
  const res = await githubFetch(
    repoPath(`${owner}/${repo}`),
    undefined,
    signal,
  ).catch((err: unknown) => {
    if (err instanceof Error && err.message.startsWith('GitHub API error 404'))
      throw errors.taskResolve.invalidRepo(
        `langgraph-harness can't reach ${owner}/${repo} — check the URL and that langgraph-harness has access.`,
      );
    throw err;
  });
  const data = (await res.json()) as {
    full_name: string;
    default_branch: string;
  };

  // Unlike GitLab, an empty repo still reports a default branch, so check that the branch exists.
  await githubFetch(
    `${repoPath(data.full_name)}/branches/${encodeURIComponent(data.default_branch)}`,
    undefined,
    signal,
  ).catch((err: unknown) => {
    if (err instanceof Error && err.message.startsWith('GitHub API error 404'))
      throw errors.taskResolve.invalidRepo(
        `${data.full_name} has no default branch (is it an empty repository?)`,
      );
    throw err;
  });

  return { projectPath: data.full_name, defaultBranch: data.default_branch };
}

// Issue comments are edited by their own id, not under the issue.
export async function upsertIssueComment(
  projectPath: string,
  issueNumber: string,
  body: string,
  commentId?: number,
): Promise<number> {
  if (commentId) {
    try {
      await githubFetch(
        `${repoPath(projectPath)}/issues/comments/${commentId}`,
        { method: 'PATCH', body: JSON.stringify({ body }) },
      );

      return commentId;
    } catch (err) {
      // Deleted by someone — post a fresh one rather than failing every later run.
      if (!isNotFoundApiError(err)) throw err;
    }
  }

  const res = await githubFetch(
    `${repoPath(projectPath)}/issues/${issueNumber}/comments`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
  return ((await res.json()) as { id: number }).id;
}

export async function createDraftPullRequest(params: {
  projectPath: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  reviewer: string | null;
}): Promise<{ number: number; htmlUrl: string; draft: boolean }> {
  const {
    projectPath,
    sourceBranch,
    targetBranch,
    title,
    description,
    reviewer,
  } = params;
  const create = (draft: boolean) =>
    githubFetch(`${repoPath(projectPath)}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        body: description,
        head: sourceBranch,
        base: targetBranch,
        draft,
      }),
    });

  let draft = true;
  let res: Response;
  try {
    res = await create(draft);
  } catch (err) {
    // Private repos on GitHub Free/Pro reject drafts outright, so every retry would hit the same 422.
    if (
      !(err instanceof Error) ||
      !err.message.startsWith('GitHub API error 422') ||
      !err.message.includes('Draft pull requests are not supported')
    )
      throw err;
    draft = false;
    res = await create(draft);
  }
  const pr = (await res.json()) as { number: number; html_url: string };

  // Unlike GitLab, reviewers can't be set on create — and a failed request (e.g. reviewer isn't a collaborator) mustn't orphan the PR that now exists.
  if (reviewer) {
    await githubFetch(
      `${repoPath(projectPath)}/pulls/${pr.number}/requested_reviewers`,
      { method: 'POST', body: JSON.stringify({ reviewers: [reviewer] }) },
    ).catch((err) =>
      logger.error(
        { err, projectPath, prNumber: pr.number, reviewer },
        'Failed to request PR reviewer',
      ),
    );
  }

  return { number: pr.number, htmlUrl: pr.html_url, draft };
}

export async function updatePullRequest(params: {
  projectPath: string;
  prNumber: string;
  description?: string;
  draft?: boolean;
}): Promise<void> {
  const { projectPath, prNumber, description, draft } = params;
  const res = await githubFetch(`${repoPath(projectPath)}/pulls/${prNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: description }),
  });

  // REST can't leave draft state — only this GraphQL mutation can.
  if (draft === false) {
    const { node_id } = (await res.json()) as { node_id: string };
    const gqlRes = await githubFetch(graphqlUrl, {
      method: 'POST',
      body: JSON.stringify({
        query:
          'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }',
        variables: { id: node_id },
      }),
    });
    const { errors } = (await gqlRes.json()) as {
      errors?: { message: string }[];
    };
    if (errors?.length)
      throw new Error(`GitHub GraphQL error: ${errors[0].message}`);
  }
}

// Review threads' resolved state is GraphQL-only — shaped like the MCP tool's get_review_comments output so one parser reads both.
export async function fetchReviewThreads(
  projectPath: string,
  prNumber: string,
): Promise<string> {
  const [owner, name] = projectPath.split('/');
  const res = await githubFetch(graphqlUrl, {
    method: 'POST',
    body: JSON.stringify({
      query:
        'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { isResolved comments(first: 1) { nodes { author { login } createdAt } } } } } } }',
      variables: { owner, name, number: Number(prNumber) },
    }),
  });
  const { data, errors } = (await res.json()) as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads: {
            nodes: Array<{
              isResolved: boolean;
              comments: {
                nodes: Array<{
                  author: { login: string } | null;
                  createdAt: string;
                }>;
              };
            }>;
          };
        };
      };
    };
    errors?: { message: string }[];
  };
  if (errors?.length)
    throw new Error(`GitHub GraphQL error: ${errors[0].message}`);

  const threads = data?.repository?.pullRequest?.reviewThreads.nodes ?? [];
  return JSON.stringify({
    review_threads: threads.map((thread) => ({
      is_resolved: thread.isResolved,
      comments: thread.comments.nodes.map((comment) => ({
        author: comment.author?.login,
        created_at: comment.createdAt,
      })),
    })),
  });
}

// One request, so GitHub posts every comment or none of them.
export async function createPullRequestReview(
  projectPath: string,
  prNumber: string,
  review: {
    event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
    body?: string;
    commit_id?: string;
    comments: {
      path: string;
      body: string;
      line: number;
      side: 'LEFT' | 'RIGHT';
      start_line?: number;
      start_side?: 'LEFT' | 'RIGHT';
    }[];
  },
) {
  const res = await githubFetch(
    `${repoPath(projectPath)}/pulls/${prNumber}/reviews`,
    { method: 'POST', body: JSON.stringify(review) },
  );
  const { id, state } = (await res.json()) as { id: number; state: string };
  return { id, state };
}

export async function replyToReviewComment(
  projectPath: string,
  prNumber: string,
  commentId: number,
  body: string,
) {
  const res = await githubFetch(
    `${repoPath(projectPath)}/pulls/${prNumber}/comments/${commentId}/replies`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
  return ((await res.json()) as { id: number }).id;
}

export async function setReviewThreadResolved(
  threadId: string,
  resolved: boolean,
) {
  const mutation = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
  const res = await githubFetch(graphqlUrl, {
    method: 'POST',
    body: JSON.stringify({
      query: `mutation($id: ID!) { ${mutation}(input: { threadId: $id }) { thread { isResolved } } }`,
      variables: { id: threadId },
    }),
  });
  const { errors } = (await res.json()) as { errors?: { message: string }[] };
  if (errors?.length)
    throw new Error(`GitHub GraphQL error: ${errors[0].message}`);
}

export async function fetchPullRequestFilePatch(
  projectPath: string,
  prNumber: string,
  path: string,
  signal?: AbortSignal,
) {
  for (let page = 1; ; page++) {
    const res = await githubFetch(
      `${repoPath(projectPath)}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      undefined,
      signal,
    );
    const files = (await res.json()) as { filename: string; patch?: string }[];
    const file = files.find((f) => f.filename === path);
    if (file || files.length < 100) return file?.patch;
  }
}

export async function fetchReviewThreadTarget(threadId: string) {
  const res = await githubFetch(graphqlUrl, {
    method: 'POST',
    body: JSON.stringify({
      query:
        'query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { pullRequest { number repository { nameWithOwner } } } } }',
      variables: { id: threadId },
    }),
  });
  const { data } = (await res.json()) as {
    data?: {
      node?: {
        pullRequest?: { number: number; repository: { nameWithOwner: string } };
      } | null;
    };
  };
  const pr = data?.node?.pullRequest;
  return pr
    ? { projectPath: pr.repository.nameWithOwner, prNumber: pr.number }
    : undefined;
}

// The latest of the bot's request, review and removal events decides — a removal after its last review means it's no longer a reviewer.
export async function isStillReviewer(
  projectPath: string,
  prNumber: number,
  login: string,
): Promise<boolean> {
  type TimelineEvent = {
    event?: string;
    user?: { login?: string };
    requested_reviewer?: { login?: string };
  };
  let latest: string | undefined;
  for (let page = 1; ; page++) {
    const res = await githubFetch(
      `${repoPath(projectPath)}/issues/${prNumber}/timeline?per_page=100&page=${page}`,
    );
    const events = (await res.json()) as TimelineEvent[];
    for (const e of events) {
      const isBot =
        e.event === 'reviewed'
          ? e.user?.login === login
          : (e.event === 'review_requested' ||
              e.event === 'review_request_removed') &&
            e.requested_reviewer?.login === login;
      if (isBot) latest = e.event;
    }
    if (events.length < 100) break;
  }
  return latest === 'review_requested' || latest === 'reviewed';
}
