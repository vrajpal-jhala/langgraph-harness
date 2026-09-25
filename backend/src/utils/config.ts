import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  type LLM,
  LLMProvider,
  ModelName,
  type SupermemoryProject,
} from '#types.js';

const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
const gitlabApiUrl = process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4';

// Comma-separated list of GitLab project-path substrings to restrict workflows to (e.g. "/project-a/,/project-b/")
const workflowProjectPathFilters = (
  process.env.WORKFLOW_PROJECT_PATH_FILTERS || ''
)
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean);

// An empty filter list means "no restriction configured" — every project is in scope.
export const isProjectInScope = (
  filters: string[],
  projectPath: string,
): boolean =>
  filters.length === 0 || filters.some((f) => projectPath.includes(f));

const workItemResolveRunTimeoutMs = 20 * 60 * 1000; // 20 minutes

// DATA_PATH is always the host root; APP_DATA_PATH (unset in dev) overrides dataPath below.
if (!process.env.DATA_PATH || !isAbsolute(process.env.DATA_PATH)) {
  throw new Error('DATA_PATH must be set to an absolute path');
}
const hostDataPath = join(process.env.DATA_PATH, 'app');

export const config = {
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  dataPath: process.env.APP_DATA_PATH
    ? resolve(process.env.APP_DATA_PATH)
    : hostDataPath,
  hostDataPath,
  auth: {
    sessionSecret: process.env.SESSION_SECRET || '',
    webhookTokens: (process.env.WEBHOOK_TOKENS || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    adminGitlabUsernames: (process.env.ADMIN_GITLAB_USERNAMES || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    trustedOrigins: (process.env.AUTH_TRUSTED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  secrets: {
    encryptionKey: process.env.SECRETS_ENCRYPTION_KEY || '',
  },
  redis: {
    url: redisUrl.toString(),
    bullmq: {
      host: redisUrl.hostname,
      port: parseInt(redisUrl.port || '6379'),
      ...(redisUrl.password && {
        password: decodeURIComponent(redisUrl.password),
      }),
    },
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'harness',
  },
  gitlab: {
    pat: process.env.GITLAB_PAT || '',
    apiUrl: gitlabApiUrl,
    username: process.env.GITLAB_BOT_USERNAME || '',
    commitIdentity: {
      name: process.env.GITLAB_BOT_NAME || 'langgraph-harness',
      email: process.env.GITLAB_BOT_EMAIL || 'bot@example.com',
    },
    oauth: {
      // Empty means no restriction — every GitLab email domain can sign in.
      allowedEmailDomains: (process.env.AUTH_ALLOWED_EMAIL_DOMAINS || '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean),
      clientId: process.env.GITLAB_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.GITLAB_OAUTH_CLIENT_SECRET || '',
    },
  },
  supermemory: {
    url: process.env.SUPERMEMORY_URL || 'http://localhost:6767',
    apiKey: process.env.SUPERMEMORY_API_KEY || '',
  },
  repositories: {
    worktreeRetentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    maintenanceIntervalMs: 60 * 60 * 1000, // 1 hour
    gitTimeoutMs: 5 * 60 * 1000, // 5 minutes
    worktreeAcquireMaxRetries: 3,
  },
  generation: {
    temperature: 0.1,
    reasoning: false,
    provider: {
      [LLMProvider.OpenRouter]: {
        apiKey: process.env.OPENROUTER_API_KEY || '',
      },
      [LLMProvider.Ollama]: {
        url: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        apiKey: process.env.OLLAMA_API_KEY || '',
        concurrency: 2,
      },
      [LLMProvider.Sglang]: {
        url: process.env.SGLANG_BASE_URL || 'http://localhost:30000',
        apiKey: process.env.SGLANG_API_KEY || '',
        concurrency: 4,
      },
      [LLMProvider.Gemini]: {
        apiKey: process.env.GEMINI_API_KEY || '',
      },
      [LLMProvider.Groq]: {
        apiKey: process.env.GROQ_API_KEY || '',
      },
    },
  },
  lightpanda: {
    cdpUrl: process.env.LIGHTPANDA_CDP_URL || 'http://localhost:9222',
  },
  chat: {
    cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
    retentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    runTimeout: 10 * 60 * 1000, // 10 minutes
  },
  mrReview: {
    concurrency: 4,
    debounce: 5 * 60 * 1000,
    lockDuration: 5 * 60 * 1000,
    maxStalledCount: 2,
    runTimeout: 10 * 60 * 1000, // 10 minutes
    projectPathFilters: workflowProjectPathFilters,
    // Source branches matching this pattern are stable/promotion branches — skip review.
    stableBranchPattern:
      '^(dev(elop(ment)?)?|stag(e|ing)?|master|main)(-v\\d+)?$',
    archivalCleanupIntervalMs: 60 * 60 * 1000, // 1 hour
    archivalRetentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  workItemResolve: {
    concurrency: 4,
    lockDuration: 5 * 60 * 1000,
    maxStalledCount: 2,
    runTimeout: workItemResolveRunTimeoutMs,
    recursionLimit: 800,
    runCap: 10,
    projectPathFilters: workflowProjectPathFilters,
  },
  taskResolve: {
    concurrency: 4,
    lockDuration: 5 * 60 * 1000,
    maxStalledCount: 2,
    runTimeout: workItemResolveRunTimeoutMs,
    recursionLimit: 800,
    runCap: 10,
  },
  openSandbox: {
    url: process.env.OPENSANDBOX_URL || 'http://localhost:8080',
    apiKey: process.env.OPENSANDBOX_API_KEY || '',
    resource: { cpu: '2', memory: '4Gi' },
    // A small margin over workItemResolve.runTimeout so the app-level timeout fires first, not the sandbox's own.
    timeoutSeconds: workItemResolveRunTimeoutMs / 1000 + 60,
    // prevent timeout on cold-pull an uncached image
    requestTimeoutSeconds: 5 * 60,
    useServerProxy: process.env.NODE_ENV === 'development',
  },
  monitoring: {
    url: process.env.MONITORING_URL || 'http://localhost:4100',
    apiKey: process.env.MONITORING_API_KEY || '',
  },
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  instructions: {
    // Character cap on the concatenated repository-instructions block. A rough
    // proxy for a token budget — swap for a real token counter later.
    maxChars: 32_000,
  },
  summarization: {
    // Widens the summarization trigger margin: tokenCounter undercounts vs. the real chat template, observed gap exceeded 7.6K tokens on tool-heavy runs.
    triggerSafetyBuffer: 0.1,
  },
  mock: {
    webhook: process.env.NODE_ENV === 'development',
    workflow: process.env.NODE_ENV === 'development',
    queue: process.env.NODE_ENV === 'development',
  },
};

export const noteFooter = `---
*AI can make mistakes. Spot a problem? [File an issue](${process.env.ISSUE_TRACKER_URL || 'https://github.com/vrajpal-jhala/langgraph-harness/issues/new'}).*`;

// For OpenSandbox's volume hostPath.
export const toHostDataPath = (containerPath: string): string =>
  join(config.hostDataPath, relative(config.dataPath, containerPath));

export const llms: LLM[] = [
  {
    provider: LLMProvider.OpenRouter,
    name: 'Gemini 2.5 Flash Lite',
    model: ModelName.Gemini25FlashLite,
    contextWindow: 1_048_576,
  },
  {
    provider: LLMProvider.OpenRouter,
    name: 'GPT 5 Mini',
    model: ModelName.Gpt5Mini,
    contextWindow: 400_000,
  },
  {
    provider: LLMProvider.OpenRouter,
    name: 'Claude Haiku 4.5',
    model: ModelName.ClaudeHaiku45,
    contextWindow: 200_000,
  },
  {
    provider: LLMProvider.OpenRouter,
    name: 'Sonnet 5',
    model: ModelName.Sonnet5,
    contextWindow: 1_000_000,
  },
  {
    provider: LLMProvider.Sglang,
    name: 'Qwen 3.6 (35B, AWQ)',
    model: ModelName.Qwen36Awq,
    contextWindow: 262_144,
    tokenizerRepo: 'Qwen/Qwen3.6-35B-A3B',
    isDefault: true,
  },
  {
    provider: LLMProvider.Sglang,
    name: 'Qwen 3.8 (27B, FP8)',
    model: ModelName.Qwen38_27BFp8,
    contextWindow: 262_144,
    // Shares the 35B's tokenizer (same Qwen3.6 family).
    tokenizerRepo: 'Qwen/Qwen3.6-35B-A3B',
  },
  {
    provider: LLMProvider.Sglang,
    name: 'Qwen 3.6 (27B, AWQ)',
    model: ModelName.Qwen36_27BAwq,
    contextWindow: 262_144,
    // Shares the 35B's tokenizer (same Qwen3.6 family).
    tokenizerRepo: 'Qwen/Qwen3.6-35B-A3B',
  },
  {
    provider: LLMProvider.Ollama,
    name: 'Qwen 3.6 (35B)',
    model: ModelName.Qwen36,
    contextWindow: 262_144,
    tokenizerRepo: 'Qwen/Qwen3.6-35B-A3B',
  },
  {
    provider: LLMProvider.Ollama,
    name: 'Qwen 3.6 (27B)',
    model: ModelName.Qwen36_27B,
    contextWindow: 262_144,
    // Shares the 35B's tokenizer (same Qwen3.6 family).
    tokenizerRepo: 'Qwen/Qwen3.6-35B-A3B',
  },
  {
    provider: LLMProvider.Ollama,
    name: 'Qwen 3.5 (9B)',
    model: ModelName.Qwen35,
    contextWindow: 262_144,
  },
  {
    provider: LLMProvider.Ollama,
    name: 'Gemma 4 (31B)',
    model: ModelName.Gemma431B,
    contextWindow: 262_144,
  },
  {
    provider: LLMProvider.Gemini,
    name: 'Gemini Flash',
    model: ModelName.GeminiFlashLatest,
    contextWindow: 1_048_576,
  },
  {
    provider: LLMProvider.Gemini,
    name: 'Gemini Flash Lite',
    model: ModelName.GeminiFlashLiteLatest,
    contextWindow: 1_048_576,
  },
  {
    provider: LLMProvider.Groq,
    name: 'GPT-OSS 120B',
    model: ModelName.GroqGptOss120B,
    contextWindow: 131_072,
  },
];

// PoC — GitLab projects ingested into supermemory (see supermemory/ at the repo
// root). search_project_history/get_project_issue fan out across all of these.
// Empty by default — add your own GitLab projects here to enable chat's
// project-history tools.
export const supermemoryProjects: SupermemoryProject[] = [];
