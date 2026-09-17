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
  const serverPort = backendEnv.SERVER_PORT;

  return {
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      'import.meta.env.VITE_API_URL': 'location.origin',
      'import.meta.env.VITE_GITLAB_URL': JSON.stringify(gitlabUrl),
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
