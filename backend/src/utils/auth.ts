import crypto from 'crypto';
import { Elysia } from 'elysia';

import { Role, type Session } from '#types.js';

import { auth } from '#components/auth/index.js';
import { config } from './config.js';

import { db } from '#utils/db.js';

export const isAdmin = (session: Session) => session.role === Role.Admin;

export const authMacro = new Elysia({ name: 'auth-macro' }).macro({
  auth: {
    async resolve({ request, status }) {
      const session: Session | null = await auth.api.getSession({
        headers: request.headers,
      });
      if (!session) return status(401, 'Unauthorized');
      return { session };
    },
  },
});

// Transparently refreshes the token via the stored refresh_token if expired.
export const getGitlabAccessToken = async (
  userId: string,
): Promise<string | undefined> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- account table not in typed Database
    const [acc] = await (db as any)
      .selectFrom('account')
      .select('id')
      .where('userId', '=', userId)
      .where('providerId', '=', 'gitlab')
      .limit(1)
      .execute();
    if (!acc) return undefined;
    const result = await auth.api.getAccessToken({
      body: { accountId: acc.id, userId },
    });
    return result.accessToken;
  } catch {
    return undefined;
  }
};

// Returns false (not throw) on length mismatch — timingSafeEqual itself throws when buffers differ in length.
const timingSafeEqualStr = (a: string, b: string) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

const captureRawBody = async (request: Request, contentType: string) => {
  if (contentType !== 'application/json') return;
  // Captured before Elysia parses to JSON — the signature is over these exact raw bytes.
  const raw = await request.text();
  // request is request-scoped (one Request per call), so this mutation is concurrency-safe.
  (request as unknown as { rawBody?: string }).rawBody = raw;
  return raw.length ? JSON.parse(raw) : {};
};

// GitHub webhook signature verification (X-Hub-Signature-256: HMAC-SHA256 over the raw body).
export const githubWebhookAuth = new Elysia({ name: 'github-webhook-auth' })
  .onParse(({ request }, contentType) => captureRawBody(request, contentType))
  .onBeforeHandle(({ headers, status, request }) => {
    if (!config.github.enabled) return status(404, 'Not Found');
    if (config.mock.webhook) return undefined;

    const received = headers['x-hub-signature-256'];
    if (!received) return status(401, 'Unauthorized');

    const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? '';
    const ok = config.auth.githubWebhookTokens.some((secret) =>
      timingSafeEqualStr(
        `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`,
        received,
      ),
    );
    if (!ok) return status(401, 'Unauthorized');
    return undefined;
  })
  .as('scoped');

// GitLab webhook signature verification (Standard Webhooks scheme).
export const gitlabWebhookAuth = new Elysia({ name: 'gitlab-webhook-auth' })
  .onParse(({ request }, contentType) => captureRawBody(request, contentType))
  .onBeforeHandle(({ headers, status, request }) => {
    if (!config.gitlab.enabled) return status(404, 'Not Found');
    if (config.mock.webhook) return undefined;

    const id = headers['webhook-id'];
    const timestamp = headers['webhook-timestamp'];
    const received = headers['webhook-signature'];
    if (!id || !timestamp || !received) return status(401, 'Unauthorized');

    const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? '';
    const receivedSigs = received.split(' ');

    // The signature carries no key id, so try every configured webhook secret.
    const ok = config.auth.gitlabWebhookTokens.some((token) => {
      const rawKey = Buffer.from(token.replace(/^whsec_/, ''), 'base64');
      const digest = crypto
        .createHmac('sha256', rawKey)
        .update(`${id}.${timestamp}.${rawBody}`)
        .digest('base64');
      const expected = `v1,${digest}`;
      // webhook-signature may carry multiple space-separated signatures; accept any match.
      return receivedSigs.some((sig) => timingSafeEqualStr(expected, sig));
    });
    if (!ok) return status(401, 'Unauthorized');
    return undefined;
  })
  .as('scoped');
