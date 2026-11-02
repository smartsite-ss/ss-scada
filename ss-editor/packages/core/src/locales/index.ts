// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { createI18n } from 'vue-i18n';
import enUS from './en-US.json';
import zhCN from './zh-CN.json';

// ── Single language registry: adding a language only requires registering here + a corresponding json file ──
// key is the primary language code; aliases are legacy/short aliases for compatibility
export const SUPPORTED_LOCALES = {
  'zh-CN': { aliases: ['zh'], messages: zhCN },
  'en-US': { aliases: ['en'], messages: enUS },
} as const;

export type SupportedLocale = keyof typeof SUPPORTED_LOCALES;

function buildMessages(): Record<string, any> {
  const messages: Record<string, any> = {};
  for (const [locale, definition] of Object.entries(SUPPORTED_LOCALES)) {
    messages[locale] = definition.messages;
    for (const alias of definition.aliases) {
      messages[alias] = definition.messages;
    }
  }
  return messages;
}

function buildFallbackLocale(): Record<string, string[]> {
  const fallback: Record<string, string[]> = { default: ['en-US'] };
  for (const [locale, definition] of Object.entries(SUPPORTED_LOCALES)) {
    for (const alias of definition.aliases) {
      fallback[alias] = [locale];
    }
  }
  return fallback;
}

/**
 * Public facade type for the i18n instance.
 *
 * Background: under TS 5.9, resolving vue-i18n 9.x Composer['t'] generic overloads triggers
 * TS2589 (type instantiation too deep). We therefore narrow the exported type to a lightweight
 * interface via an unknown intermediate cast; the runtime instance is unchanged and consumers
 * need no modifications.
 * Note: call sites of app.use(i18n) must assert themselves (e.g. `app.use(i18n as any)`).
 */
export interface II18nGlobalFacade {
  t: (key: string, params?: Record<string, unknown>) => string;
  locale: { value: string };
  mergeLocaleMessage: (locale: string, messages: Record<string, unknown>) => void;
}

export interface II18nFacade {
  global: II18nGlobalFacade;
}

const i18nInstance = createI18n({
  legacy: false, // use Composition API mode, compatible with useI18n()
  locale: 'zh-CN', // default language
  fallbackLocale: buildFallbackLocale(), // fallback language + language code aliases
  globalInjection: true, // globally inject $t and other methods
  messages: buildMessages(),
});

export const i18n = i18nInstance as unknown as II18nFacade;

export { useI18n } from 'vue-i18n';

export function getLocale(): string {
  return i18n.global.locale.value;
}

export function setLocale(locale: SupportedLocale): void {
  i18n.global.locale.value = locale;
}

/**
 * Translation function for non-component modules (convenience wrapper, equivalent to i18n.global.t(key)).
 */
export function translate(key: string): string {
  return i18n.global.t(key);
}

// ── Language registration (shared by plugins/subsystems, aliases auto-filled) ──
export function registerLocaleMessages(locale: string, messages: Record<string, any>): void {
  i18n.global.mergeLocaleMessage(locale, messages);
  const definition = (SUPPORTED_LOCALES as Record<string, { aliases?: readonly string[] }>)[locale];
  for (const alias of definition?.aliases ?? []) {
    i18n.global.mergeLocaleMessage(alias, messages);
  }
}

// Batch-register the result of import.meta.glob('./locales/*.json', { eager: true })
export function registerLocaleModules(localeModules: Record<string, any>): void {
  for (const [modulePath, moduleValue] of Object.entries(localeModules)) {
    const fileName = modulePath.split('/').pop() ?? '';
    const locale = fileName.replace(/\.json$/, '');
    if (!locale) continue;
    // Compatible with both import.meta.glob return shapes: { default } or the object directly
    const messages = moduleValue?.default ?? moduleValue;
    registerLocaleMessages(locale, messages);
  }
}
