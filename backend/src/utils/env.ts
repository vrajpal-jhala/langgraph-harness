import { readFileSync } from 'fs';
import { resolve } from 'path';

const OPTIONAL = new Set([
  'OPENROUTER_API_KEY',
  'OLLAMA_API_KEY',
  'SGLANG_API_KEY',
  'SUPERMEMORY_API_KEY',
  'OPENSANDBOX_API_KEY',
  'MONITORING_API_KEY',
  'WORKFLOW_PROJECT_PATH_FILTERS',
  'AUTH_ALLOWED_EMAIL_DOMAINS',
  'GITLAB_BOT_NAME',
  'GITLAB_BOT_EMAIL',
  'ISSUE_TRACKER_URL',
]);

export function validateEnv() {
  const example = readFileSync(
    resolve(import.meta.dirname, '../../.env.example'),
    'utf8',
  );
  const required = example
    .split('\n')
    .map((line) => line.split('=')[0].trim())
    .filter((key) => key && !key.startsWith('#') && !OPTIONAL.has(key));

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables:\n  ${missing.join('\n  ')}\n\nCopy .env.example to .env and fill in the values.`,
    );
  }
}
