interface ViteTypeOptions {
  strictImportMetaEnv: true;
}

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_GITLAB_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
