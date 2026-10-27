interface ViteTypeOptions {
  strictImportMetaEnv: true;
}

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_GITLAB_URL: string;
  readonly VITE_GITHUB_URL: string;
  readonly VITE_GITHUB_SIGN_IN: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
