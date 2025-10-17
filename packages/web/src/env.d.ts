/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_MATRIX_HOMESERVER_URL: string
  readonly VITE_ELEMENT_CALL_URL: string
  readonly VITE_APP_NAME: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
