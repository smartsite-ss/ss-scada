// Global type declarations

declare interface Window {
  $message: {
    error: (message: string) => void
    success: (message: string) => void
    warning: (message: string) => void
    info: (message: string) => void
  }
  $t: (key: string) => string
}

// Augment the global process object
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string
    VITE_HTTP_PROXY: string
    VITE_PRO_PATH: string
  }
}

// Augment import.meta.env
declare interface ImportMetaEnv {
  VITE_HTTP_PROXY: string
  VITE_PRO_PATH: string
  PROD: boolean
  DEV: boolean
}

// Augment the axios instance
declare module 'axios' {
  export interface AxiosInstance {
    <T = any>(config: AxiosRequestConfig): Promise<T>
  }
}
