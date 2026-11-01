interface ImportMetaEnv {
  readonly MAIN_VITE_LICENSE_PUBLIC_KEY?: string
  readonly MAIN_VITE_LICENSE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
