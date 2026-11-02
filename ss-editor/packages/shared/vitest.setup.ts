// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { config } from '@vue/test-utils';

// Globally mock vue-i18n's $t to prevent components like SmartTablePagination from erroring in unit tests
config.global.mocks = {
  $t: (key: string, params?: Record<string, any>) => {
    if (!params) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(`{${k}}`, String(v));
    }
    return result;
  },
};
