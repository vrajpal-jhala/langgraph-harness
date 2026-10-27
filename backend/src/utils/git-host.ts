import { type GitHost, GitProvider } from '#types.js';

import { config } from './config.js';
import * as github from './github.js';
import * as gitlab from './gitlab.js';
import { mcpToolName } from './helpers.js';

// GitLab namespaces can't start with "@", so this can never collide with a GitLab path.
const GITHUB_REPO_KEY_PREFIX = '@github/';

const gitlabDiscussionNote = mcpToolName(
  GitProvider.GitLab,
  'create_merge_request_discussion_note',
);
const githubPullRequestRead = mcpToolName(
  GitProvider.GitHub,
  'pull_request_read',
);
const githubIssueComment = mcpToolName(GitProvider.GitHub, 'add_issue_comment');
const githubReviewReply = mcpToolName(
  GitProvider.GitHub,
  'add_reply_to_pull_request_comment',
);

export const gitHosts: Record<GitProvider, GitHost> = {
  [GitProvider.GitLab]: {
    provider: GitProvider.GitLab,
    name: 'GitLab',
    codeChangeRequestName: 'merge request',
    commitIdentity: config.gitlab.commitIdentity,
    // Bare path, as before GitHub support, so existing repo state stays valid.
    repoKey: (projectPath) => projectPath,
    remoteUrl: (projectPath) =>
      `https://oauth2:${config.gitlab.pat}@${new URL(config.gitlab.apiUrl).host}/${projectPath}.git`,
    formatAlert: (type, title, body) =>
      `> [!${type.toUpperCase()}] ${title}\n> ${body}`,
    codeChangeRequestIdentifier: (mrIid) => `merge_request_iid ${mrIid}`,
    repoIdentifiers: (projectPath) => `project_id "${projectPath}"`,
    issueIdentifiers: (projectPath, issueIid) =>
      `${gitHosts[GitProvider.GitLab].repoIdentifiers(projectPath)}, issue_iid ${issueIid}`,
    issueTools: {
      read: new Set(['mr_discussions', 'list_issue_discussions']),
      write: new Set(['create_merge_request_discussion_note']),
    },
    discussion: {
      issueComments: [
        { name: mcpToolName(GitProvider.GitLab, 'list_issue_discussions') },
      ],
      codeChangeRequestFeedback: [
        { name: mcpToolName(GitProvider.GitLab, 'mr_discussions') },
      ],
      replies: [gitlabDiscussionNote],
      replyGuidance: `call \`${gitlabDiscussionNote}\` with that discussion's id`,
    },
    fetchIssue: (projectPath, issueIid, issueKind, signal) =>
      issueKind === 'work_item'
        ? gitlab.fetchWorkItem(projectPath, issueIid, signal)
        : gitlab.fetchIssue(projectPath, issueIid, signal),
    fetchRepoFile: gitlab.fetchRepoFile,
    upsertIssueComment: gitlab.upsertIssueNote,
    upsertCodeChangeRequestComment: gitlab.upsertMrNote,
    createDraftCodeChangeRequest: async ({
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
      return { mrIid: String(mr.iid), mrUrl: mr.webUrl, draft: true };
    },
    updateCodeChangeRequest: ({ projectPath, ...rest }) =>
      gitlab.updateMergeRequest({ projectId: projectPath, ...rest }),
  },
  [GitProvider.GitHub]: {
    provider: GitProvider.GitHub,
    name: 'GitHub',
    codeChangeRequestName: 'pull request',
    commitIdentity: config.github.commitIdentity,
    repoKey: (projectPath) => `${GITHUB_REPO_KEY_PREFIX}${projectPath}`,
    remoteUrl: (projectPath) =>
      `https://x-access-token:${config.github.pat}@${new URL(config.github.webUrl).host}/${projectPath}.git`,
    // GitHub only recognises the marker alone on its line — a title after it turns the whole block into a plain quote.
    formatAlert: (type, title, body) =>
      `> [!${type.toUpperCase()}]\n> **${title}**\n>\n> ${body}`,
    codeChangeRequestIdentifier: (mrIid) => `pullNumber ${mrIid}`,
    repoIdentifiers: (projectPath) => {
      const [owner, repo] = projectPath.split('/');
      return `owner "${owner}", repo "${repo}"`;
    },
    issueIdentifiers: (projectPath, issueIid) =>
      `${gitHosts[GitProvider.GitHub].repoIdentifiers(projectPath)}, issue_number ${issueIid}`,
    issueTools: {
      read: new Set(['issue_read', 'pull_request_read']),
      write: new Set([
        'add_issue_comment',
        'add_reply_to_pull_request_comment',
      ]),
    },
    discussion: {
      issueComments: [
        {
          name: mcpToolName(GitProvider.GitHub, 'issue_read'),
          method: 'get_comments',
        },
      ],
      codeChangeRequestFeedback: [
        { name: githubPullRequestRead, method: 'get_comments' },
        { name: githubPullRequestRead, method: 'get_review_comments' },
        { name: githubPullRequestRead, method: 'get_reviews' },
      ],
      replies: [githubIssueComment, githubReviewReply],
      // Unlike GitLab, GitHub has two reply paths depending on where the comment lives.
      replyGuidance: `call \`${githubReviewReply}\` with the comment's id for an inline review comment, or \`${githubIssueComment}\` for a general pull request comment or review`,
    },
    fetchIssue: (projectPath, issueIid, _issueKind, signal) =>
      github.fetchIssue(projectPath, issueIid, signal),
    fetchRepoFile: github.fetchRepoFile,
    upsertIssueComment: github.upsertIssueComment,
    // A pull request's conversation comments are issue comments in GitHub's API.
    upsertCodeChangeRequestComment: github.upsertIssueComment,
    createDraftCodeChangeRequest: async ({
      projectPath,
      reviewerUsername,
      ...rest
    }) => {
      const pr = await github.createDraftPullRequest({
        projectPath,
        reviewer: reviewerUsername,
        ...rest,
      });
      return { mrIid: String(pr.number), mrUrl: pr.htmlUrl, draft: pr.draft };
    },
    updateCodeChangeRequest: ({ mrIid, ...rest }) =>
      github.updatePullRequest({ prNumber: mrIid, ...rest }),
  },
};

export const parseRepoKey = (
  key: string,
): { host: GitHost; projectPath: string } =>
  key.startsWith(GITHUB_REPO_KEY_PREFIX)
    ? {
        host: gitHosts[GitProvider.GitHub],
        projectPath: key.slice(GITHUB_REPO_KEY_PREFIX.length),
      }
    : { host: gitHosts[GitProvider.GitLab], projectPath: key };
