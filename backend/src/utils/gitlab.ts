import { config } from './config.js';
import { errors } from './errors.js';

// Bound each GitLab request so a slow/unresponsive API fails fast instead of
// holding a queue slot (undici's default header/body timeouts are ~300s).
const GITLAB_FETCH_TIMEOUT_MS = 15_000;

// Shared GitLab fetch client — centralizes auth headers, timeout, and error handling.

/** Options for a GitLab fetch request. */
interface GitLabFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Skip injecting the default PRIVATE-TOKEN auth header. */
  skipDefaultHeaders?: boolean;
}

/**
 * Perform a GitLab API request.
 *
 * For read-only calls, pass an optional `parentSignal` to combine the timeout
 * with the caller's abort signal (e.g. from a LangGraph node timeout).
 * For write calls, omit `parentSignal` — cancelling a write after GitLab
 * received it wouldn't undo it, so there's no benefit to propagating the
 * abort signal for writes.
 */
async function gitlabFetch(
  url: string,
  opts?: GitLabFetchOptions,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () =>
      controller.abort(
        new DOMException('GitLab request timed out', 'TimeoutError'),
      ),
    GITLAB_FETCH_TIMEOUT_MS,
  );
  const onParentAbort = () => controller.abort(parentSignal!.reason);
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const headers = opts?.skipDefaultHeaders
      ? opts?.headers
      : {
          'PRIVATE-TOKEN': config.gitlab.pat,
          ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
          ...opts?.headers,
        };
    const res = await fetch(url, {
      ...opts,
      headers,
      signal: controller.signal,
    });
    if (!res.ok)
      throw new Error(`GitLab API error ${res.status}: ${await res.text()}`);
    return res;
  } finally {
    clearTimeout(timeoutId);
    // AbortSignal.any() would leave this dangling on parentSignal until it fires, pinning the run.
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

function notesUrl(projectId: string, mrIid: string, noteId?: number) {
  const encoded = encodeURIComponent(projectId);
  const base = `${config.gitlab.apiUrl}/projects/${encoded}/merge_requests/${mrIid}/notes`;
  return noteId ? `${base}/${noteId}` : base;
}

function issueNotesUrl(projectId: string, issueIid: string, noteId?: number) {
  const encoded = encodeURIComponent(projectId);
  const base = `${config.gitlab.apiUrl}/projects/${encoded}/issues/${issueIid}/notes`;
  return noteId ? `${base}/${noteId}` : base;
}

export async function fetchMrDiscussions(
  projectId: string,
  mrIid: string,
  signal?: AbortSignal,
): Promise<string> {
  const encoded = encodeURIComponent(projectId);
  const url = `${config.gitlab.apiUrl}/projects/${encoded}/merge_requests/${mrIid}/discussions?page=1&per_page=100`;
  const res = await gitlabFetch(url, undefined, signal);
  // matching the MCP tool's own response shape
  const items = await res.json();
  return JSON.stringify({ items });
}

export async function fetchIssue(
  projectId: string,
  issueIid: string,
  signal?: AbortSignal,
): Promise<{ title: string; description: string; labels: string[] }> {
  const encoded = encodeURIComponent(projectId);
  const url = `${config.gitlab.apiUrl}/projects/${encoded}/issues/${issueIid}`;
  const res = await gitlabFetch(url, undefined, signal);
  const data = (await res.json()) as {
    title: string;
    description: string | null;
    labels: string[];
  };
  return {
    title: data.title,
    description: data.description ?? '',
    labels: data.labels,
  };
}

const WORK_ITEM_QUERY = `
  query($fullPath: ID!, $iid: String!) {
    namespace(fullPath: $fullPath) {
      workItem(iid: $iid) {
        title
        widgets {
          ... on WorkItemWidgetDescription {
            description
          }
          ... on WorkItemWidgetLabels {
            labels {
              nodes {
                title
              }
            }
          }
        }
      }
    }
  }
`;

export async function fetchWorkItem(
  projectPath: string,
  issueIid: string,
  signal?: AbortSignal,
): Promise<{ title: string; description: string; labels: string[] }> {
  const url = `${new URL(config.gitlab.apiUrl).origin}/api/graphql`;
  const res = await gitlabFetch(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.gitlab.pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: WORK_ITEM_QUERY,
        variables: { fullPath: projectPath, iid: issueIid },
      }),
      skipDefaultHeaders: true,
    },
    signal,
  );

  const { data, errors } = (await res.json()) as {
    data?: {
      namespace?: {
        workItem?: {
          title: string;
          widgets: (
            | { description?: string | null }
            | { labels?: { nodes: { title: string }[] } }
          )[];
        } | null;
      } | null;
    };
    errors?: { message: string }[];
  };
  if (errors?.length)
    throw new Error(`GitLab GraphQL error: ${errors[0].message}`);

  const workItem = data?.namespace?.workItem;
  if (!workItem)
    throw new Error(`Work item ${issueIid} not found in ${projectPath}`);

  const descriptionWidget = workItem.widgets.find(
    (w): w is { description?: string | null } => 'description' in w,
  );
  const labelsWidget = workItem.widgets.find(
    (w): w is { labels: { nodes: { title: string }[] } } => 'labels' in w,
  );

  return {
    title: workItem.title,
    description: descriptionWidget?.description ?? '',
    labels: labelsWidget?.labels.nodes.map((l) => l.title) ?? [],
  };
}

export async function fetchRepoFile(
  projectId: string,
  path: string,
  ref = 'HEAD',
): Promise<string | null> {
  const encodedProject = encodeURIComponent(projectId);
  const encodedPath = encodeURIComponent(path);
  // ref=HEAD resolves to the repository's default branch
  const url = `${config.gitlab.apiUrl}/projects/${encodedProject}/repository/files/${encodedPath}?ref=${ref}`;
  const res = await fetch(url, {
    headers: { 'PRIVATE-TOKEN': config.gitlab.pat },
    signal: AbortSignal.timeout(GITLAB_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(`GitLab API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: string };
  // GitLab returns file content as base64
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

export async function resolveGitlabUserId(
  username: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const url = `${config.gitlab.apiUrl}/users?username=${encodeURIComponent(username)}`;
  const res = await gitlabFetch(url, undefined, signal);
  const users = (await res.json()) as { id: number }[];
  return users[0]?.id ?? null;
}

// Strips the origin and any GitLab-added suffix (/-/tree/main, .git, trailing slash) off a browser URL to leave the project's path_with_namespace.
function projectPathFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw errors.taskResolve.invalidRepo(`Not a valid URL: ${url}`);
  }

  const apiHost = new URL(config.gitlab.apiUrl).host;
  if (parsed.host !== apiHost) {
    throw errors.taskResolve.invalidRepo(
      `Repository must be on ${apiHost}, got ${parsed.host || url}`,
    );
  }

  const path = parsed.pathname
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '')
    .split('/-/')[0];

  if (path.split('/').length < 2) {
    throw errors.taskResolve.invalidRepo(`URL is not a project path: ${url}`);
  }
  return path;
}

export async function resolveProjectFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<{ projectPath: string; defaultBranch: string }> {
  const projectPath = projectPathFromUrl(url);
  const encoded = encodeURIComponent(projectPath);
  // A project the bot can't see is indistinguishable from one that doesn't exist — GitLab 404s both.
  const res = await gitlabFetch(
    `${config.gitlab.apiUrl}/projects/${encoded}`,
    undefined,
    signal,
  ).catch(() => {
    throw errors.taskResolve.invalidRepo(
      `langgraph-harness can't reach ${projectPath} — check the URL and that langgraph-harness has access.`,
    );
  });
  const data = (await res.json()) as {
    path_with_namespace: string;
    default_branch: string | null;
  };

  if (!data.default_branch) {
    throw errors.taskResolve.invalidRepo(
      `${data.path_with_namespace} has no default branch (is it an empty repository?)`,
    );
  }

  return {
    projectPath: data.path_with_namespace,
    defaultBranch: data.default_branch,
  };
}

// Inverse of projectPathFromUrl.
export function projectUrlFromPath(projectPath: string): string {
  return `${new URL(config.gitlab.apiUrl).origin}/${projectPath}`;
}

export async function createDraftMergeRequest(params: {
  projectId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  reviewerId: number | null;
}): Promise<{ iid: number; webUrl: string }> {
  const {
    projectId,
    sourceBranch,
    targetBranch,
    title,
    description,
    reviewerId,
  } = params;
  const encoded = encodeURIComponent(projectId);
  const url = `${config.gitlab.apiUrl}/projects/${encoded}/merge_requests`;
  const res = await gitlabFetch(url, {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      source_branch: sourceBranch,
      target_branch: targetBranch,
      draft: true,
      ...(reviewerId && { reviewer_ids: [reviewerId] }),
    }),
  });
  const data = (await res.json()) as { iid: number; web_url: string };
  return { iid: data.iid, webUrl: data.web_url };
}

export async function upsertMrNote(
  projectId: string,
  mrIid: string,
  body: string,
  noteId?: number,
): Promise<number> {
  const res = await gitlabFetch(notesUrl(projectId, mrIid, noteId), {
    method: noteId ? 'PUT' : 'POST',
    body: JSON.stringify({ body }),
  });
  return noteId ?? ((await res.json()) as { id: number }).id;
}

export async function upsertIssueNote(
  projectId: string,
  issueIid: string,
  body: string,
  noteId?: number,
): Promise<number> {
  const res = await gitlabFetch(issueNotesUrl(projectId, issueIid, noteId), {
    method: noteId ? 'PUT' : 'POST',
    body: JSON.stringify({ body }),
  });
  return noteId ?? ((await res.json()) as { id: number }).id;
}

export async function updateMergeRequest(params: {
  projectId: string;
  mrIid: string;
  description?: string;
  draft?: boolean;
}): Promise<void> {
  const { projectId, mrIid, ...patch } = params;
  const encoded = encodeURIComponent(projectId);
  const url = `${config.gitlab.apiUrl}/projects/${encoded}/merge_requests/${mrIid}`;
  await gitlabFetch(url, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}
