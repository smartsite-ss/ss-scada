// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import deDE from './de-DE.json';
import enUS from './en-US.json';
import esMX from './es-MX.json';
import frFR from './fr-FR.json';
import idID from './id-ID.json';
import jaJP from './ja-JP.json';
import koKR from './ko-KR.json';
import msMY from './ms-MY.json';
import ptBR from './pt-BR.json';
import ruRU from './ru-RU.json';
import thTH from './th-TH.json';
import trTR from './tr-TR.json';
import viVN from './vi-VN.json';
import zhCN from './zh-CN.json';
import zhTW from './zh-TW.json';
import type { I18nResource, SupportedLocale } from '../utils/I18nProvider';
import { I18nProvider } from '../utils/I18nProvider';

export { deDE, enUS, esMX, frFR, idID, jaJP, koKR, msMY, ptBR, ruRU, thTH, trTR, viVN, zhCN, zhTW };

const systemLocales: Record<SupportedLocale, I18nResource> = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'th-TH': thTH,
  'de-DE': deDE,
  'fr-FR': frFR,
  'ru-RU': ruRU,
  'pt-BR': ptBR,
  'id-ID': idID,
  'vi-VN': viVN,
  'es-MX': esMX,
  'tr-TR': trTR,
  'ms-MY': msMY,
};

export function loadSystemLocale(locale: SupportedLocale): I18nResource {
  return systemLocales[locale];
}

export function syncSystemLocales(): void {
  I18nProvider.registerPluginLocale('__system__', async () => {
    return { default: systemLocales[I18nProvider.locale] };
  });
}
