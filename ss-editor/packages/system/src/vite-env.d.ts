// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/// <reference types="vite/client" />
/// <reference types="vue-i18n" />
/// <reference types="vue-router" />

// Ensure the file is a module (not a script), preventing declare module from shadowing existing types
export {};

declare global {
  const __APP_VERSION__: string;
  const __BUILD_TIME__: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}