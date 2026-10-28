import { readFileSync } from 'fs';
import { resolve } from 'path';

const OPTIONAL = new Set([
  'OPENROUTER_API_KEY',
  'OLLAMA_API_KEY',
  'SGLANG_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'SUPERMEMORY_API_KEY',
  'OPENSANDBOX_API_KEY',
  'MONITORING_API_KEY',
  'WORKFLOW_PROJECT_PATH_FILTERS',
  'AUTH_ALLOWED_EMAIL_DOMAINS',
  'ISSUE_TRACKER_URL',
]);

// A provider is enabled only when every one of its vars is set; its other vars (API URL, bot commit identity, ...) have defaults.
export const PROVIDER_ENV_VARS = {
  gitlab: [
    'GITLAB_PAT',
    'GITLAB_BOT_USERNAME',
    'GITLAB_WEBHOOK_TOKENS',
    'GITLAB_OAUTH_CLIENT_ID',
    'GITLAB_OAUTH_CLIENT_SECRET',
    'GITLAB_ADMIN_USERNAMES',
  ],
  github: [
    'GITHUB_PAT',
    'GITHUB_BOT_USERNAME',
    'GITHUB_WEBHOOK_TOKENS',
    'GITHUB_OAUTH_CLIENT_ID',
    'GITHUB_OAUTH_CLIENT_SECRET',
    'GITHUB_ADMIN_USERNAMES',
  ],
} as const;

const isProviderVar = (key: string) => /^GIT(LAB|HUB)_/.test(key);

export function validateEnv() {
  const example = readFileSync(
    resolve(import.meta.dirname, '../../.env.example'),
    'utf8',
  );
  const required = example
    .split('\n')
    .map((line) => line.split('=')[0].trim())
    .filter(
      (key) =>
        key &&
        !key.startsWith('#') &&
        !OPTIONAL.has(key) &&
        !isProviderVar(key),
    );

  const problems = required
    .filter((key) => !process.env[key])
    .map((key) => `${key} is not set`);

  const providers = Object.entries(PROVIDER_ENV_VARS).map(([name, vars]) => ({
    name,
    missing: vars.filter((key) => !process.env[key]),
    total: vars.length,
  }));
  for (const { name, missing, total } of providers) {
    if (missing.length > 0 && missing.length < total) {
      problems.push(
        `${name} is partially configured, missing: ${missing.join(', ')}`,
      );
    }
  }
  if (providers.every(({ missing, total }) => missing.length === total)) {
    problems.push(
      `No git provider configured, set either all of ${PROVIDER_ENV_VARS.gitlab.join(', ')} or all of ${PROVIDER_ENV_VARS.github.join(', ')}`,
    );
  }

  if (problems.length) {
    throw new Error(
      `Invalid environment configuration:\n  ${problems.join('\n  ')}\n\nCopy .env.example to .env and fill in the values.`,
    );
  }
}
