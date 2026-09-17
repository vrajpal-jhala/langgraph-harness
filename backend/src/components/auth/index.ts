import { betterAuth } from 'better-auth';
import { customSession } from 'better-auth/plugins';

import { Role } from '#types.js';

import { config } from '#utils/config.js';
import { pool } from '#utils/db.js';

const GITLAB_CALLBACK_PATH = '/callback/gitlab';

const stripGitlabUsername = (user: Record<string, unknown>) => {
  if (!('gitlabUsername' in user)) return;
  const rest = { ...user };
  delete rest.gitlabUsername;
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
  },
  user: {
    validateUserInfo: ({ user, source }) => {
      if (source.oauth?.providerId !== 'gitlab') return;

      // An empty list means no restriction configured — every domain is allowed.
      if (
        config.gitlab.oauth.allowedEmailDomains.length > 0 &&
        !config.gitlab.oauth.allowedEmailDomains.some((allowedEmailDomain) =>
          user.email?.endsWith(`@${allowedEmailDomain}`),
        )
      ) {
        return {
          error: 'email_not_allowed',
          errorDescription: `Use ${config.gitlab.oauth.allowedEmailDomains.length > 1 ? 'one of ' : ''}${config.gitlab.oauth.allowedEmailDomains.join(', ')} email to sign in`,
        };
      }
    },
    additionalFields: {
      gitlabUsername: { type: 'string', required: false },
    },
  },
  databaseHooks: {
    user: {
      // Backstop: blocks additionalFields writes outside the GitLab callback.
      create: {
        before: async (user, context) =>
          context?.path === GITLAB_CALLBACK_PATH
            ? undefined
            : stripGitlabUsername(user),
      },
      update: {
        before: async (user, context) =>
          context?.path === GITLAB_CALLBACK_PATH
            ? undefined
            : stripGitlabUsername(user),
      },
    },
  },
  plugins: [
    customSession(async ({ user }) => {
      const gitlabUsername =
        (user as typeof user & { gitlabUsername?: string }).gitlabUsername ??
        '';

      return {
        id: user.id,
        username: gitlabUsername,
        name: user.name,
        avatarUrl: user.image ?? null,
        role: config.auth.adminGitlabUsernames.includes(gitlabUsername)
          ? Role.Admin
          : Role.Viewer,
      };
    }),
  ],
  socialProviders: {
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
  },
});
