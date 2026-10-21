import { GitProvider } from '#types.js';

import { config } from './config.js';
import * as github from './github.js';
import * as gitlab from './gitlab.js';

// GitLab namespaces can't start with "@", so this can never collide with a GitLab path.
const GITHUB_REPO_KEY_PREFIX = '@github/';

// Disk, lock and memory key for a repo — the same owner/repo path can exist on both providers. GitLab keeps its bare path so existing state stays valid.
export const repoKey = (provider: GitProvider, projectPath: string) =>
  provider === GitProvider.GitHub
    ? `${GITHUB_REPO_KEY_PREFIX}${projectPath}`
    : projectPath;

export const parseRepoKey = (
  key: string,
): { provider: GitProvider; projectPath: string } =>
  key.startsWith(GITHUB_REPO_KEY_PREFIX)
    ? {
        provider: GitProvider.GitHub,
        projectPath: key.slice(GITHUB_REPO_KEY_PREFIX.length),
      }
    : { provider: GitProvider.GitLab, projectPath: key };

type Issue = { title: string; description: string; labels: string[] };

type Forge = {
  name: string;
  mrName: string;
  commitIdentity: { name: string; email: string };
  remoteUrl: (projectPath: string) => string;
  fetchIssue: (
    projectPath: string,
    issueIid: string,
    issueKind: 'issue' | 'work_item',
    signal?: AbortSignal,
  ) => Promise<Issue>;
  fetchRepoFile: (projectPath: string, path: string) => Promise<string | null>;
  upsertIssueNote: (
    projectPath: string,
    issueIid: string,
    body: string,
    noteId?: number,
  ) => Promise<number>;
  createDraftMr: (params: {
    projectPath: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
    reviewerUsername: string | null;
    signal?: AbortSignal;
  }) => Promise<{ mrIid: string; mrUrl: string }>;
  updateMr: (params: {
    projectPath: string;
    mrIid: string;
    description: string;
    draft?: boolean;
  }) => Promise<void>;
};

const forges: Record<GitProvider, Forge> = {
  [GitProvider.GitLab]: {
    name: 'GitLab',
    mrName: 'merge request',
    commitIdentity: config.gitlab.commitIdentity,
    remoteUrl: (projectPath) =>
      `https://oauth2:${config.gitlab.pat}@${new URL(config.gitlab.apiUrl).host}/${projectPath}.git`,
    fetchIssue: (projectPath, issueIid, issueKind, signal) =>
      issueKind === 'work_item'
        ? gitlab.fetchWorkItem(projectPath, issueIid, signal)
        : gitlab.fetchIssue(projectPath, issueIid, signal),
    fetchRepoFile: gitlab.fetchRepoFile,
    upsertIssueNote: gitlab.upsertIssueNote,
    createDraftMr: async ({
      projectPath,
      reviewerUsername,
      signal,
      ...rest
    }) => {
      const reviewerId = reviewerUsername
        ? await gitlab.resolveGitlabUserId(reviewerUsername, signal)
        : null;
      const mr = await gitlab.createDraftMergeRequest({
        projectId: projectPath,
        reviewerId,
        ...rest,
      });
      return { mrIid: String(mr.iid), mrUrl: mr.webUrl };
    },
    updateMr: ({ projectPath, ...rest }) =>
      gitlab.updateMergeRequest({ projectId: projectPath, ...rest }),
  },
  [GitProvider.GitHub]: {
    name: 'GitHub',
    mrName: 'pull request',
    commitIdentity: config.github.commitIdentity,
    remoteUrl: (projectPath) =>
      `https://x-access-token:${config.github.pat}@${new URL(config.github.webUrl).host}/${projectPath}.git`,
    fetchIssue: (projectPath, issueIid, _issueKind, signal) =>
      github.fetchIssue(projectPath, issueIid, signal),
    fetchRepoFile: github.fetchRepoFile,
    upsertIssueNote: github.upsertIssueComment,
    createDraftMr: async ({ projectPath, reviewerUsername, ...rest }) => {
      const pr = await github.createDraftPullRequest({
        projectPath,
        reviewer: reviewerUsername,
        ...rest,
      });
      return { mrIid: String(pr.number), mrUrl: pr.htmlUrl };
    },
    updateMr: ({ mrIid, ...rest }) =>
      github.updatePullRequest({ prNumber: mrIid, ...rest }),
  },
};

// Runs created before GitHub support carry no provider — those are all GitLab.
export const forgeFor = (provider: GitProvider = GitProvider.GitLab) =>
  forges[provider];
