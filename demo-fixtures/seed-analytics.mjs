#!/usr/bin/env node
// Seeds the harness DB with synthetic thread/run/run_summary/memory rows so the
// Analytics and Threads views have realistic volume for demo screenshots — no
// real project or review data involved anywhere. Purely additive: re-running
// adds another batch rather than deduping, so only run this against a DB you're
// fine accumulating fake rows in (see demo-fixtures/README.md for wiping it first).

import pg from 'pg';
import { randomUUID } from 'node:crypto';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/harness';
const THREAD_COUNT = Number(process.env.SEED_COUNT || 60);

const PROJECTS = [
  'acme/website',
  'acme/mobile-app',
  'acme/infra',
  'acme/api',
  'acme/design-system',
];

const KIND_WEIGHTS = [
  ['mr_review', 0.55],
  ['work_item_resolve', 0.2],
  ['chat', 0.2],
  ['task_resolve', 0.05],
];

const ERROR_KINDS = [
  'timeout',
  'guardAbort',
  'manualAbort',
  'modelError',
  'serverRestart',
  'generationLoop',
];

// Must match the middleware keys the Analytics page's guardrail table looks up per kind
// (frontend/src/pages/analytics/index.tsx) — any other key silently renders as zero rows.
const COMMON_NUDGES = [
  'DuplicateCallGuard',
  'TrailingQuestionGuard',
  'NoToolCallGuard',
  'ExtractProjectMemory',
];
const NUDGE_MIDDLEWARES = {
  mr_review: COMMON_NUDGES,
  chat: ['HumanApproval'],
  work_item_resolve: [...COMMON_NUDGES, 'DiscussionCheckGuard'],
  task_resolve: [...COMMON_NUDGES, 'DiscussionCheckGuard'],
};

const MR_TITLES = [
  'Fix pagination off-by-one on the orders list',
  'Add retry logic to the payment webhook handler',
  'Refactor auth middleware to drop the legacy session shim',
  'Speed up product search with a trigram index',
  'Extract shared date-formatting helper',
  'Fix flaky checkout integration test',
  'Add rate limiting to the public API',
  'Clean up unused feature-flag branches',
];

const ISSUE_TITLES = [
  'Add dark mode toggle to settings',
  'Export order history as CSV',
  'Support bulk-archiving old threads',
  'Add webhook retry backoff configuration',
  'Improve error message when a GitLab token expires',
];

const CHAT_MESSAGES = [
  'What changed in the last deploy?',
  'Summarize open MRs for acme/api this week',
  'Why did the last review on !142 time out?',
  'Draft a changelog entry for the rate-limit fix',
];

const MEMORY_ENTRIES = [
  {
    category: 'convention',
    title: 'Prefers early returns',
    content:
      'Team consistently prefers early returns over nested conditionals in review comments.',
  },
  {
    category: 'false_positive',
    title: 'Flaky payment webhook test',
    content:
      'The payment webhook suite has a known-flaky timing test — do not flag failures there as caused by the current change.',
  },
  {
    category: 'decision',
    title: 'No default exports',
    content: 'Team decided against default exports repo-wide; flag new ones.',
  },
  {
    category: 'convention',
    title: 'SCSS BEM nesting',
    content:
      'BEM elements/modifiers must nest under their block with &__/&--, not flat top-level selectors.',
  },
  {
    category: 'false_positive',
    title: 'Generated types churn',
    content:
      '__generated__/*.d.ts diffs are expected noise after any schema change — do not comment on them.',
  },
];

function pickWeighted(weights) {
  const r = Math.random();
  let acc = 0;
  for (const [value, weight] of weights) {
    acc += weight;
    if (r <= acc) return value;
  }
  return weights[weights.length - 1][0];
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Squares a uniform random so most threads land in the last few weeks, not spread flat over the window.
const recentTimestamp = (maxDaysAgo) =>
  new Date(Date.now() - Math.random() ** 2 * maxDaysAgo * 24 * 60 * 60 * 1000);

function buildInput(kind, project, mrIid) {
  switch (kind) {
    case 'mr_review':
      return {
        kind,
        query: {
          note: 'push',
          projectId: project,
          mrIid,
          sourceBranch: 'feat/demo-change',
          sourceSha: randomUUID().slice(0, 8),
          targetBranch: 'main',
        },
        model: 'openrouter/anthropic/claude-sonnet-5',
        reasoning: false,
      };
    case 'work_item_resolve':
      return {
        kind,
        projectPath: project,
        issueIid: String(randInt(1, 200)),
        defaultBranch: 'main',
        assignedBy: 'demo-user',
        issueKind: 'issue',
      };
    case 'task_resolve':
      return {
        kind,
        title: pick(ISSUE_TITLES),
        projectPath: project,
        prompt: 'Resolve this from the chat-submitted task.',
        defaultBranch: 'main',
        submittedBy: 'demo-user',
      };
    case 'chat':
      return {
        kind,
        query: { message: pick(CHAT_MESSAGES) },
        tools: { server: true, gitlab: true, webSearch: false },
      };
  }
}

function buildNudgeStats(kind) {
  const stats = {};
  for (const middleware of NUDGE_MIDDLEWARES[kind]) {
    if (Math.random() < 0.35) continue; // not every guard fires on every run
    const fired = randInt(1, 3);
    const resolved = randInt(0, fired);
    const escalated = randInt(0, fired - resolved);
    stats[middleware] = { fired, resolved, escalated };
  }
  return stats;
}

function buildRunSummary(kind, success) {
  const isReviewish = kind === 'mr_review' || kind === 'work_item_resolve';
  const toolCalls = randInt(5, 60);
  const uniqueTools = Math.min(toolCalls, randInt(3, 12));
  const promptTokens = randInt(2000, 40000);
  const completionTokens = randInt(200, 4000);

  return {
    duration_ms:
      kind === 'chat' ? randInt(3000, 40000) : randInt(20000, 240000),
    success,
    error_kind: success ? null : pick(ERROR_KINDS),
    llm_calls: randInt(3, 25),
    tool_calls: toolCalls,
    unique_tools: uniqueTools,
    repeated_tool_calls: Math.max(0, toolCalls - uniqueTools - randInt(0, 5)),
    model_retries: Math.random() < 0.1 ? 1 : 0,
    checkpoints: randInt(1, 8),
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    max_context_size: pick([128000, 200000]),
    queue_wait_ms: randInt(0, 60000),
    llm_backend_wait_ms: randInt(100, 5000),
    nudge_stats: buildNudgeStats(kind),
    comment_critic: isReviewish
      ? {
          verdicts: randInt(2, 15),
          dropped: randInt(0, 5),
          failed: 0,
          hadError: false,
          retries: 0,
        }
      : null,
    memory_curator: isReviewish
      ? {
          added: randInt(0, 2),
          updated: randInt(0, 2),
          retired: 0,
          skipped: randInt(0, 3),
          missed: 0,
          hadError: false,
          retries: 0,
        }
      : null,
    own_comments:
      kind === 'mr_review'
        ? { total: randInt(1, 8), resolved: randInt(0, 8) }
        : null,
  };
}

// Builds a thread's full run timeline up front so the thread row's own updated_at
// (set once, below) can reflect the last run's completion — with triggers disabled
// for this session, nothing overwrites it afterward.
function buildRunTimeline(threadCreatedAt) {
  const runCount = Math.random() < 0.2 ? randInt(2, 3) : 1;
  const runs = [];
  let cursor = threadCreatedAt;

  for (let r = 0; r < runCount; r++) {
    const success = Math.random() < 0.9;
    const startedAt = cursor;
    const durationMs = randInt(8000, 240000);
    const completedAt = new Date(startedAt.getTime() + durationMs);
    runs.push({
      startedAt,
      completedAt,
      status: success ? 'completed' : 'failed',
      success,
    });
    cursor = new Date(
      completedAt.getTime() + randInt(60_000, 6 * 60 * 60 * 1000),
    ); // gap before a re-review
  }
  return runs;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Bulk-loading historical rows — without this, triggers stamp every timestamp to real "now".
    await client.query('SET LOCAL session_replication_role = replica');

    for (let i = 0; i < THREAD_COUNT; i++) {
      const kind = pickWeighted(KIND_WEIGHTS);
      const project = kind === 'chat' ? null : pick(PROJECTS);
      const mrIid = kind === 'mr_review' ? String(randInt(10, 400)) : undefined;
      const threadId = randomUUID();
      const threadCreatedAt = recentTimestamp(90);

      const title =
        kind === 'mr_review'
          ? pick(MR_TITLES)
          : kind === 'work_item_resolve' || kind === 'task_resolve'
            ? pick(ISSUE_TITLES)
            : pick(CHAT_MESSAGES);

      const metadata = project ? { project, ...(mrIid ? { mrIid } : {}) } : {};
      const runs = buildRunTimeline(threadCreatedAt);
      const threadUpdatedAt = runs[runs.length - 1].completedAt;

      await client.query(
        `INSERT INTO threads (id, title, metadata, kind, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [threadId, title, metadata, kind, threadCreatedAt, threadUpdatedAt],
      );

      for (const run of runs) {
        const runId = randomUUID();
        await client.query(
          `INSERT INTO runs (id, thread_id, status, input, kind, created_at, started_at, completed_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7)`,
          [
            runId,
            threadId,
            run.status,
            buildInput(kind, project, mrIid),
            kind,
            run.startedAt,
            run.completedAt,
          ],
        );

        const summary = buildRunSummary(kind, run.success);
        await client.query(
          `INSERT INTO run_summaries
             (run_id, duration_ms, success, error_kind, llm_calls, tool_calls, unique_tools,
              repeated_tool_calls, model_retries, checkpoints, prompt_tokens, completion_tokens,
              total_tokens, max_context_size, nudge_stats, comment_critic, memory_curator,
              own_comments, queue_wait_ms, llm_backend_wait_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            runId,
            summary.duration_ms,
            summary.success,
            summary.error_kind,
            summary.llm_calls,
            summary.tool_calls,
            summary.unique_tools,
            summary.repeated_tool_calls,
            summary.model_retries,
            summary.checkpoints,
            summary.prompt_tokens,
            summary.completion_tokens,
            summary.total_tokens,
            summary.max_context_size,
            summary.nudge_stats,
            summary.comment_critic,
            summary.memory_curator,
            summary.own_comments,
            summary.queue_wait_ms,
            summary.llm_backend_wait_ms,
          ],
        );
      }
    }

    for (const entry of MEMORY_ENTRIES) {
      const userScoped = Math.random() < 0.4;
      await client.query(
        `INSERT INTO memories (id, project_id, user_id, category, title, content, evidence, source)
         VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7)`,
        [
          randomUUID(),
          userScoped ? null : pick(PROJECTS),
          userScoped ? 'demo-user' : null,
          entry.category,
          entry.title,
          entry.content,
          { kind: 'seed' },
        ],
      );
    }

    await client.query('COMMIT');
    console.log(
      `Seeded ${THREAD_COUNT} threads with runs and summaries, plus ${MEMORY_ENTRIES.length} memories.`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
