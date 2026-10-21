import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import transformImports from '@rolldown/plugin-transform-imports';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const backendEnv = loadEnv(mode, '../backend', '');
  const gitlabUrl = (
    backendEnv.GITLAB_API_URL ||
    process.env.GITLAB_API_URL ||
    ''
  ).replace('/api/v4', '');
  const githubApiUrl = new URL(
    backendEnv.GITHUB_API_URL ||
      process.env.GITHUB_API_URL ||
      'https://api.github.com',
  );
  // github.com serves its API from a separate host; GitHub Enterprise serves it under /api/v3 on the web host.
  const githubUrl =
    githubApiUrl.host === 'api.github.com'
      ? 'https://github.com'
      : githubApiUrl.origin;
  const githubSignIn = Boolean(
    backendEnv.GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_OAUTH_CLIENT_ID,
  );
  const serverPort = backendEnv.SERVER_PORT;

  return {
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      'import.meta.env.VITE_API_URL': 'location.origin',
      'import.meta.env.VITE_GITLAB_URL': JSON.stringify(gitlabUrl),
      'import.meta.env.VITE_GITHUB_URL': JSON.stringify(githubUrl),
      'import.meta.env.VITE_GITHUB_SIGN_IN': JSON.stringify(githubSignIn),
    },
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      transformImports({
        '@tabler/icons-react': {
          transform: '@tabler/icons-react/dist/esm/icons/{{member}}',
        },
      }),
    ],
    server: {
      proxy: {
        '^/api/.*': `http://localhost:${serverPort}`,
        '^/auth/.*': `http://localhost:${serverPort}`,
        '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      },
    },
  };
});
