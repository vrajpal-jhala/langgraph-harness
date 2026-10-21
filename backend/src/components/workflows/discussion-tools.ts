import { GitProvider } from '#types.js';

import { mcpToolName } from '#utils/helpers.js';

// GitHub multiplexes several reads behind one tool name via a `method` arg, so a read is identified by both.
type ToolCallSpec = { name: string; method?: string };

type DiscussionTools = {
  issueComments: ToolCallSpec;
  // GitHub splits MR feedback across three reads; GitLab returns it all from one.
  mrFeedback: ToolCallSpec[];
  replies: string[];
  replyGuidance: string;
};

const githubPullRequestRead = mcpToolName(
  GitProvider.GitHub,
  'pull_request_read',
);
const gitlabDiscussionNote = mcpToolName(
  GitProvider.GitLab,
  'create_merge_request_discussion_note',
);
const githubIssueComment = mcpToolName(GitProvider.GitHub, 'add_issue_comment');
const githubReviewReply = mcpToolName(
  GitProvider.GitHub,
  'add_reply_to_pull_request_comment',
);

const discussionToolsByProvider: Record<GitProvider, DiscussionTools> = {
  [GitProvider.GitLab]: {
    issueComments: {
      name: mcpToolName(GitProvider.GitLab, 'list_issue_discussions'),
    },
    mrFeedback: [{ name: mcpToolName(GitProvider.GitLab, 'mr_discussions') }],
    replies: [gitlabDiscussionNote],
    replyGuidance: `call \`${gitlabDiscussionNote}\` with that discussion's id`,
  },
  [GitProvider.GitHub]: {
    issueComments: {
      name: mcpToolName(GitProvider.GitHub, 'issue_read'),
      method: 'get_comments',
    },
    mrFeedback: [
      { name: githubPullRequestRead, method: 'get_comments' },
      { name: githubPullRequestRead, method: 'get_review_comments' },
      { name: githubPullRequestRead, method: 'get_reviews' },
    ],
    replies: [githubIssueComment, githubReviewReply],
    // Unlike GitLab, GitHub has two reply paths depending on where the comment lives.
    replyGuidance: `call \`${githubReviewReply}\` with the comment's id for an inline review comment, or \`${githubIssueComment}\` for a general pull request comment or review`,
  },
};

export const discussionToolsFor = (
  provider: GitProvider = GitProvider.GitLab,
) => discussionToolsByProvider[provider];

export const matchesToolCall = (
  spec: ToolCallSpec,
  call: { name: string; args?: unknown },
) =>
  call.name === spec.name &&
  (!spec.method ||
    (call.args as { method?: string } | undefined)?.method === spec.method);

export const describeToolCall = (spec: ToolCallSpec) =>
  spec.method
    ? `\`${spec.name}\` with method \`${spec.method}\``
    : `\`${spec.name}\``;

export const describeToolCalls = (specs: ToolCallSpec[]) =>
  specs.map(describeToolCall).join(', ');
