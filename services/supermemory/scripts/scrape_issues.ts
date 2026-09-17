import { access, mkdir, writeFile } from 'node:fs/promises';
import path, { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const GITLAB_API_URL =
  process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4';
const GITLAB_PAT = process.env.GITLAB_PAT || '';
const PROJECT_ID = process.argv[2] ?? '';

// Auto Time Tracker (gitlab.com/auto-tt) files weekly work-log issues that
// summarize commits already tracked elsewhere — noise for a memory store.
const EXCLUDED_AUTHOR_USERNAME = 'auto-tt';

// Keyed by project id — GitLab iids restart per-project, so a flat dir would
// collide across projects (matches the gitlab-issues:<project_id> container tag).
const OUTPUT_DIR = path.resolve(
  dirname(new URL(import.meta.url).pathname),
  '../.data/issues',
  PROJECT_ID,
);
const PER_PAGE = 100;
const DELAY_MS = 150;
// GitLab.com tolerates modest bursts fine; this keeps discussion fetches
// from serializing one-request-at-a-time across hundreds of issues.
const CONCURRENCY = 8;

interface GitlabNote {
  system: boolean;
  author: { name: string } | null;
  created_at: string;
  body: string;
}

interface GitlabDiscussion {
  notes: GitlabNote[];
}

interface GitlabIssue {
  id: number;
  iid: number;
  project_id: number;
  state: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: { name: string } | null;
  labels: string[];
  assignees: { name: string }[];
  author: { name: string; username: string } | null;
  type: string;
  assignee: { name: string } | null;
  merge_requests_count: number;
  start_date: string | null;
  due_date: string | null;
  issue_type: string;
  web_url: string;
  weight: number | null;
  blocking_issues_count: number;
  has_tasks: boolean;
  task_status: string;
  moved_to_id: number | null;
  epic: { name: string } | null;
  iteration: { name: string; start_date: string; end_date: string } | null;
}

const api = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(GITLAB_API_URL + url, {
    headers: {
      'PRIVATE-TOKEN': GITLAB_PAT,
    },
    ...options,
  });
  return response.json() as Promise<T>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

interface GitlabIssueLink {
  iid: number;
  project_id: number;
  title: string;
  link_type: 'relates_to' | 'blocks' | 'is_blocked_by';
}

// The linked issue is scraped separately as its own file (same project, so it's already in the
// corpus) — this just records the relationship in the narrative, not the frontmatter, so it gets
// extracted as a fact instead of being crowded out like other bookkeeping fields.
async function fetchIssueLinks(issueIid: number) {
  return api<GitlabIssueLink[]>(
    `/projects/${encodeURIComponent(PROJECT_ID)}/issues/${issueIid}/links`,
  );
}

export function renderIssueLinks(links: GitlabIssueLink[], projectId: string) {
  // Cross-project links point at an issue outside this scrape's scope (not a multi-project
  // rollout yet, see work item #35) — rendering "#166" for one would look locally resolvable
  // when it isn't, since that issue was never ingested.
  const sameProject = links.filter((l) => String(l.project_id) === projectId);
  if (!sameProject.length) return '';

  const linkTypeLabel: Record<GitlabIssueLink['link_type'], string> = {
    relates_to: 'relates to',
    blocks: 'blocks',
    is_blocked_by: 'is blocked by',
  };

  const body = sameProject
    .map((l) => `- ${linkTypeLabel[l.link_type]} #${l.iid}: ${l.title}`)
    .join('\n');

  return `\n\n## Linked Issues\n\n${body}\n`;
}

async function fetchAllDiscussions(issueIid: number) {
  const discussions: GitlabDiscussion[] = [];
  let page = 1;

  while (true) {
    const res = await api<GitlabDiscussion[]>(
      `/projects/${encodeURIComponent(PROJECT_ID)}/issues/${issueIid}/discussions?page=${page}&per_page=${PER_PAGE}`,
    );

    if (!res.length) break;
    discussions.push(...res);

    page++;
    await sleep(DELAY_MS);
  }

  return discussions;
}

export function renderDiscussions(discussions: GitlabDiscussion[]) {
  const comments = discussions
    .flatMap((d) => d.notes)
    // system notes are automated ("changed label to X"), not discussion
    .filter((note) => !note.system);

  if (!comments.length) return '';

  const body = comments
    .map(
      (note) =>
        `**${note.author ? note.author.name : 'Unknown'}** (${note.created_at}):\n${note.body}`,
    )
    .join('\n\n---\n\n');

  return `\n\n## Discussion\n\n${body}\n`;
}

async function saveIssue(issue: GitlabIssue) {
  const filePath = path.join(OUTPUT_DIR, `${issue.iid}.md`);

  const { title, description } = issue;
  const frontmatter = `- id: ${issue.id}
- iid: ${issue.iid}
- project_id: ${issue.project_id}
- state: ${issue.state}
- created_at: ${issue.created_at}
- updated_at: ${issue.updated_at}
- closed_at: ${issue.closed_at}
- closed_by: ${issue.closed_by ? issue.closed_by.name : 'null'}
- labels: ${issue.labels.join(', ')}
- assignees: ${issue.assignees.map((a: { name: string }) => a.name).join(', ')}
- author: ${issue.author ? issue.author.name : 'null'}
- type: ${issue.type}
- assignee: ${issue.assignee ? issue.assignee.name : 'null'}
- merge_requests_count: ${issue.merge_requests_count}
- start_date: ${issue.start_date}
- due_date: ${issue.due_date}
- issue_type: ${issue.issue_type}
- web_url: ${issue.web_url}
- weight: ${issue.weight}
- blocking_issues_count: ${issue.blocking_issues_count}
- has_tasks: ${issue.has_tasks}
- task_status: ${issue.task_status}
- moved_to_id: ${issue.moved_to_id}
- epic: ${issue.epic ? issue.epic.name : 'null'}
- iteration: ${issue.iteration ? `${issue.iteration.name} (${issue.iteration.start_date} - ${issue.iteration.end_date})` : 'null'}`;

  const [discussions, links] = await Promise.all([
    fetchAllDiscussions(issue.iid),
    fetchIssueLinks(issue.iid),
  ]);
  const body = `# ${title}\n\n${description ?? ''}${renderIssueLinks(links, PROJECT_ID)}${renderDiscussions(discussions)}`;

  await writeFile(filePath, `---\n${frontmatter}\n---\n\n${body}\n`);
}

async function fetchAllIssues() {
  if (!PROJECT_ID) {
    console.error(
      'Usage: npx tsx scripts/scrape_issues.ts <project-id-or-path>',
    );
    process.exit(1);
  }

  if (!(await exists(OUTPUT_DIR))) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  let total = 0;
  let page = 1;

  while (true) {
    const issues = await api<GitlabIssue[]>(
      `/projects/${encodeURIComponent(PROJECT_ID)}/issues?state=all&page=${page}&per_page=${PER_PAGE}&order_by=updated_at&sort=asc`,
    );

    if (!issues.length) break;

    const candidates = issues.filter(
      (issue) => issue.author?.username !== EXCLUDED_AUTHOR_USERNAME,
    );

    // Resumable: a file already on disk means that issue survived a prior
    // (possibly interrupted) run — skip re-fetching its discussions/links.
    const alreadyScraped = await Promise.all(
      candidates.map((issue) =>
        exists(path.join(OUTPUT_DIR, `${issue.iid}.md`)),
      ),
    );
    const toProcess = candidates.filter((_, i) => !alreadyScraped[i]);

    for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
      const batch = toProcess.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(saveIssue));
      total += batch.length;
    }

    page++;
    console.log(`Saved: ${total}`);

    await sleep(DELAY_MS);
  }

  console.log(`✅ Done. Total saved: ${total}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  fetchAllIssues().catch(async (err) => {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'] || 5;
      console.log(`Rate limited. Retry in ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      return fetchAllIssues();
    }

    console.error(err.message);
  });
}
