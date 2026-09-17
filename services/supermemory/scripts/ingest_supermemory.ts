import { readdir, readFile } from 'node:fs/promises';
import path, { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const SUPERMEMORY_API_URL =
  process.env.SUPERMEMORY_API_URL || 'http://localhost:6767';
const SUPERMEMORY_API_KEY = process.env.SUPERMEMORY_API_KEY || '';

const ISSUES_DIR = path.resolve(
  dirname(new URL(import.meta.url).pathname),
  '../.data/issues',
);

// Matches the fixed "- key: value" frontmatter scrape_issues.ts writes.
export function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const fieldMatch = line.match(/^- ([a-z_]+): (.*)$/);
    if (fieldMatch) fields[fieldMatch[1]] = fieldMatch[2];
  }
  return fields;
}

// Sending the frontmatter block as part of `content` (on top of the same fields already in
// `metadata` below) measurably crowds out real extraction: on a real scraped issue it produced
// 5 facts, all ticket bookkeeping, versus 10 substantive facts with the frontmatter stripped here.
export function stripFrontmatter(markdown: string) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n/, '');
}

// A literal <meta ...> tag anywhere in content (even just quoted as example code, e.g. an
// SEO/og:image ticket) makes supermemory's auto-detector misclassify the document as HTML and
// route it to a URL-fetching extractor, which then 400s since it's not a real URL. Confirmed via
// bisection on two real issues (#859, #1376) — escaping angle brackets avoids the misdetection.
export function escapeHtmlTags(content: string) {
  return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function ingestFile(filePath: string) {
  const markdown = await readFile(filePath, 'utf-8');
  const fields = parseFrontmatter(markdown);
  if (!fields) {
    console.error(`Skipping ${filePath}: no frontmatter found`);
    return;
  }

  const res = await fetch(`${SUPERMEMORY_API_URL}/v3/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPERMEMORY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: escapeHtmlTags(stripFrontmatter(markdown)),
      containerTag: `gitlab-issues:${fields.project_id}`,
      customId: `issue-${fields.project_id}-${fields.iid}`,
      taskType: 'memory',
      dreaming: 'instant',
      metadata: {
        iid: fields.iid,
        state: fields.state,
        issue_type: fields.issue_type,
        author: fields.author,
        labels: fields.labels,
        assignees: fields.assignees,
        created_at: fields.created_at,
        updated_at: fields.updated_at,
        web_url: fields.web_url,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(
      `${path.basename(filePath)}: ${res.status} ${await res.text()}`,
    );
  }
}

async function ingestAll() {
  if (!SUPERMEMORY_API_KEY) {
    console.error(
      'Usage: SUPERMEMORY_API_KEY=sm_... npx tsx scripts/ingest_supermemory.ts',
    );
    process.exit(1);
  }

  // Recursive: files now live under a per-project-id subdirectory.
  const files = (await readdir(ISSUES_DIR, { recursive: true })).filter((f) =>
    f.endsWith('.md'),
  );
  let done = 0;

  for (const file of files) {
    try {
      await ingestFile(path.join(ISSUES_DIR, file));
      done++;
    } catch (err) {
      console.error(`Failed: ${(err as Error).message}`);
    }
    // ~2hrs for 1124 files with no output otherwise makes progress unobservable.
    if (done % 25 === 0) console.log(`Ingested ${done}/${files.length}`);
  }

  console.log(`✅ Ingested ${done}/${files.length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  ingestAll().catch((err) => console.error(err.message));
}
