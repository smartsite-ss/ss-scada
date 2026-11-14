// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { registerLocaleMessages } from '@scada-editor/core';
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

export function setupSystemLocales() {
  registerLocaleMessages('zh-CN', zhCN);
  registerLocaleMessages('en-US', enUS);
  registerLocaleMessages('zh-TW', zhTW);
  registerLocaleMessages('ja-JP', jaJP);
  registerLocaleMessages('ko-KR', koKR);
  registerLocaleMessages('th-TH', thTH);
  registerLocaleMessages('de-DE', deDE);
  registerLocaleMessages('fr-FR', frFR);
  registerLocaleMessages('ru-RU', ruRU);
  registerLocaleMessages('pt-BR', ptBR);
  registerLocaleMessages('id-ID', idID);
  registerLocaleMessages('vi-VN', viVN);
  registerLocaleMessages('es-MX', esMX);
  registerLocaleMessages('tr-TR', trTR);
  registerLocaleMessages('ms-MY', msMY);
}
