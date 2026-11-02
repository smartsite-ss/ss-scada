// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { createStaticDataSource } from './static';
import { createApiDataSource } from './api';
import {
  createDatabaseDataSource,
  type DatabaseDataSource,
  type DatabaseDataSourceDeps,
} from './database';
import type { ChartDataSource, ChartDataSourceConfig } from './types';

/**
 * Chart data source factory: create static / api / database data sources by config type.
 * database requires injected fetch/subscribe dependencies (dataQueryApi + wsStore) passed in by the plugin layer.
 */
export function createChartDataSource(
  config: ChartDataSourceConfig,
  deps?: DatabaseDataSourceDeps,
): ChartDataSource {
  switch (config.type) {
    case 'api':
      return createApiDataSource(
        config.apiConfig ?? {
          url: '',
          method: 'GET',
          mapping: { dimensions: ['name', 'value'], categoryField: 'name', valueField: 'value' },
        },
      );
    case 'database': {
      if (!deps) {
        throw new Error('[ChartDataSource] database data source requires injected dataQueryApi and wsStore dependencies');
      }
      return createDatabaseDataSource(
        config.databaseConfig ?? { mode: 'latest', tags: [] },
        deps,
      );
    }
    case 'static':
    default:
      return createStaticDataSource(
        config.staticConfig ?? { dimensions: ['name', 'value'], source: [] },
      );
  }
}

export type { DatabaseDataSource };
