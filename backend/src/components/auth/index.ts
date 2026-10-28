import { betterAuth } from 'better-auth';
import { customSession } from 'better-auth/plugins';

import { Role } from '#types.js';

import { config } from '#utils/config.js';
import { pool } from '#utils/db.js';

// Each provider's username field may only be written by that provider's own OAuth callback.
const USERNAME_FIELD_BY_CALLBACK_PATH: Record<string, string> = {
  '/callback/gitlab': 'gitlabUsername',
  '/callback/github': 'githubUsername',
};

const stripForeignUsernames = (
  user: Record<string, unknown>,
  path: string | undefined,
) => {
  const allowed = path ? USERNAME_FIELD_BY_CALLBACK_PATH[path] : undefined;
  const foreign = Object.values(USERNAME_FIELD_BY_CALLBACK_PATH).filter(
    (field) => field !== allowed && field in user,
  );
  if (!foreign.length) return;
  const rest = { ...user };
  for (const field of foreign) delete rest[field];
  return { data: rest };
};

const origins = [config.appUrl, ...config.auth.trustedOrigins];

export const auth = betterAuth({
  database: pool,
  baseURL: {
    allowedHosts: origins.map((o) => new URL(o).host),
    fallback: config.appUrl,
  },
  basePath: '/auth',
  secret: config.auth.sessionSecret,
  trustedOrigins: origins,
  // Otherwise internal-error redirects fall back to a `/error` route the frontend doesn't have, so no toast ever shows.
  onAPIError: {
    errorURL: `${config.appUrl}/login`,
  },
  advanced: {
    // Decided once at boot (better-auth can't vary Secure per-host per-request), so any trusted HTTP origin (e.g. a LAN IP) disables it for all origins.
    useSecureCookies: origins.every((o) => new URL(o).protocol === 'https:'),
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
      trustedProxies: ['127.0.0.1'],
    },
  },
  // The only client-writable path to additionalFields; nothing here calls it.
  disabledPaths: ['/update-user'],
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      // Otherwise linking a second provider from Settings never records that provider's username.
      updateUserInfoOnLink: true,
      // Linking requires signing in to the other provider, so the emails needn't match for it to be safe.
      allowDifferentEmails: true,
    },
  },
  user: {
    validateUserInfo: ({ user, source }) => {
      if (!source.oauth) return;

      const { allowedEmailDomains } = config.auth;
      if (
        allowedEmailDomains.length > 0 &&
        !allowedEmailDomains.some((allowedEmailDomain) =>
          user.email?.endsWith(`@${allowedEmailDomain}`),
        )
      ) {
        return {
          error: 'email_not_allowed',
          errorDescription: `Use ${allowedEmailDomains.length > 1 ? 'one of ' : ''}${allowedEmailDomains.join(', ')} email to sign in`,
        };
      }
    },
    additionalFields: {
      gitlabUsername: { type: 'string', required: false },
      githubUsername: { type: 'string', required: false },
    },
  },
  databaseHooks: {
    user: {
      // Backstop: blocks additionalFields writes outside their provider's callback.
      create: {
        before: async (user, context) =>
          stripForeignUsernames(user, context?.path),
      },
      update: {
        before: async (user, context) =>
          stripForeignUsernames(user, context?.path),
      },
    },
  },
  plugins: [
    customSession(async ({ user }) => {
      const { gitlabUsername = '', githubUsername = '' } =
        user as typeof user & {
          gitlabUsername?: string;
          githubUsername?: string;
        };
      // better-auth saves the GitLab user ID as text when the user signs in; MR webhooks send the same ID as a number.
      const { rows } = await pool.query<{ accountId: string }>(
        `SELECT "accountId" FROM account WHERE "userId" = $1 AND "providerId" = 'gitlab' LIMIT 1`,
        [user.id],
      );

      return {
        id: user.id,
        gitlabUsername,
        githubUsername,
        gitlabId: rows[0] ? Number(rows[0].accountId) : null,
        name: user.name,
        avatarUrl: user.image ?? null,
        // Matched per provider, so a GitHub handle that happens to equal an admin's GitLab handle grants nothing.
        role:
          config.auth.gitlabAdminUsernames.includes(gitlabUsername) ||
          config.auth.githubAdminUsernames.includes(githubUsername)
            ? Role.Admin
            : Role.Viewer,
      };
    }),
  ],
  socialProviders: {
    ...(config.gitlab.enabled && {
      gitlab: {
        clientId: config.gitlab.oauth.clientId,
        clientSecret: config.gitlab.oauth.clientSecret,
        scope: ['api'],
        disableDefaultScope: true,
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({
          emailVerified: true,
          gitlabUsername: profile.username,
        }),
      },
    }),
    ...(config.github.enabled && {
      github: {
        clientId: config.github.oauth.clientId,
        clientSecret: config.github.oauth.clientSecret,
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({
          githubUsername: profile.login,
        }),
      },
    }),
  },
});
