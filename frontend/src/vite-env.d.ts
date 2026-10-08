/// <reference types="vite/client" />

interface ImportMetaEnv {
  // The deployed API's address, without a trailing /api. Unset in development.
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
