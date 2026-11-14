// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export enum Language {
  ZH_CN = 'zh-CN',
  EN_US = 'en-US',
  ZH_TW = 'zh-TW',
  JA_JP = 'ja-JP',
  KO_KR = 'ko-KR',
  TH_TH = 'th-TH',
  DE_DE = 'de-DE',
  FR_FR = 'fr-FR',
  RU_RU = 'ru-RU',
  PT_BR = 'pt-BR',
  ID_ID = 'id-ID',
  VI_VN = 'vi-VN',
  ES_MX = 'es-MX',
  TR_TR = 'tr-TR',
  MS_MY = 'ms-MY',
}

export const SUPPORTED_LANGUAGES: string[] = Object.values(Language);

export const DEFAULT_LANGUAGE = Language.ZH_CN;

export const LANGUAGE_NAMES: Record<string, string> = {
  [Language.ZH_CN]: '简体中文',
  [Language.EN_US]: 'English',
  [Language.ZH_TW]: '繁體中文',
  [Language.JA_JP]: '日本語',
  [Language.KO_KR]: '한국어',
  [Language.TH_TH]: 'ไทย',
  [Language.DE_DE]: 'Deutsch',
  [Language.FR_FR]: 'Français',
  [Language.RU_RU]: 'Русский',
  [Language.PT_BR]: 'Português (Brasil)',
  [Language.ID_ID]: 'Bahasa Indonesia',
  [Language.VI_VN]: 'Tiếng Việt',
  [Language.ES_MX]: 'Español (México)',
  [Language.TR_TR]: 'Türkçe',
  [Language.MS_MY]: 'Bahasa Melayu',
};

/** Exact tag → canonical locale (lowercased keys). */
const EXACT_ALIASES: Record<string, string> = {
  zh: Language.ZH_CN,
  'zh-cn': Language.ZH_CN,
  'zh-hans': Language.ZH_CN,
  'zh-sg': Language.ZH_CN,
  'zh-tw': Language.ZH_TW,
  'zh-hk': Language.ZH_TW,
  'zh-mo': Language.ZH_TW,
  'zh-hant': Language.ZH_TW,
  en: Language.EN_US,
  'en-us': Language.EN_US,
  'en-gb': Language.EN_US,
  'en-au': Language.EN_US,
  ja: Language.JA_JP,
  'ja-jp': Language.JA_JP,
  ko: Language.KO_KR,
  'ko-kr': Language.KO_KR,
  th: Language.TH_TH,
  'th-th': Language.TH_TH,
  de: Language.DE_DE,
  'de-de': Language.DE_DE,
  fr: Language.FR_FR,
  'fr-fr': Language.FR_FR,
  ru: Language.RU_RU,
  'ru-ru': Language.RU_RU,
  pt: Language.PT_BR,
  'pt-br': Language.PT_BR,
  'pt-pt': Language.PT_BR,
  id: Language.ID_ID,
  'id-id': Language.ID_ID,
  vi: Language.VI_VN,
  'vi-vn': Language.VI_VN,
  es: Language.ES_MX,
  'es-mx': Language.ES_MX,
  'es-es': Language.ES_MX,
  tr: Language.TR_TR,
  'tr-tr': Language.TR_TR,
  ms: Language.MS_MY,
  'ms-my': Language.MS_MY,
};

/**
 * Normalize an incoming language tag (query / cookie / Accept-Language) to a
 * canonical supported locale. Returns the trimmed original value when unknown.
 */
export function normalizeLanguage(lang: string): string {
  if (!lang) return '';
  const lower = lang.trim().toLowerCase();
  if (!lower) return '';

  // Traditional Chinese variants carry the script/region in later subtags.
  if (lower.startsWith('zh')) {
    if (/hant|tw|hk|mo/.test(lower)) return Language.ZH_TW;
    return Language.ZH_CN;
  }

  const exact = EXACT_ALIASES[lower];
  if (exact) return exact;

  const base = lower.split('-')[0];
  return EXACT_ALIASES[base] ?? lang;
}
