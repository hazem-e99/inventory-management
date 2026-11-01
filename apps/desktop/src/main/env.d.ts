interface ImportMetaEnv {
  readonly MAIN_VITE_LICENSE_PUBLIC_KEY?: string
  readonly MAIN_VITE_LICENSE_SERVER_URL?: string
  readonly MAIN_VITE_UPDATE_PUBLIC_KEY?: string
  /** Only for the verification build, which is driven over the debugging port. */
  readonly MAIN_VITE_ALLOW_DEBUGGING?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
