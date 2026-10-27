import { config } from './config.js';
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

// Issue comments are edited by their own id, not under the issue.
export async function upsertIssueComment(
  projectPath: string,
  issueNumber: string,
  body: string,
  commentId?: number,
): Promise<number> {
  const res = await githubFetch(
    commentId
      ? `${repoPath(projectPath)}/issues/comments/${commentId}`
      : `${repoPath(projectPath)}/issues/${issueNumber}/comments`,
    {
      method: commentId ? 'PATCH' : 'POST',
      body: JSON.stringify({ body }),
    },
  );
  return commentId ?? ((await res.json()) as { id: number }).id;
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
