import { join } from 'node:path';
import pino from 'pino';

import { config } from './config.js';

// No rotation — logging is sparse (lifecycle/error events, not per-request), file stays small.
const logFile = join(config.dataPath, 'logs', 'server.log');

// Auth headers carry bare tokens — blank them whole.
const FULL_REDACT_KEYS = new Set(['authorization', 'cookie']);
// The GitLab PAT rides inside git remote URLs (git-service args, execa errors) — scrub just the creds.
const urlCredentials = /(\/\/)[^/@\s:]+:[^/@\s]+@/g;

function censor(value: unknown, path: string[]): unknown {
  if (FULL_REDACT_KEYS.has(path[path.length - 1])) return '[REDACTED]';

  return typeof value === 'string'
    ? value.replace(urlCredentials, '$1[REDACTED]@')
    : '[REDACTED]';
}

export const logger = pino({
  level: config.logger.level,
  redact: {
    censor,
    paths: [
      'request.headers.authorization',
      'request.headers.cookie',
      'request.body.apiKey',
      'args[*]',
      'err.command',
      'err.shortMessage',
      'err.stderr',
      'err.stdout',
      'err.message',
      'err.stack',
    ],
  },
  transport: {
    targets: [
      {
        target: 'pino/file',
        options: { destination: logFile, mkdir: true },
        level: config.logger.level,
      },
      process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
              ignore: 'pid,hostname',
              errorLikeObjectKeys: ['err', 'error'],
            },
            level: config.logger.level,
          }
        : {
            target: 'pino/file',
            options: { destination: 1 }, // stdout, for container log collection
            level: config.logger.level,
          },
    ],
  },
});
