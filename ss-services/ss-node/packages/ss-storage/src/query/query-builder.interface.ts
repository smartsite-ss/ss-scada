// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { QueryOptions } from '../interfaces/storage-adapter.interface';

/**
 * Query dialect builder contract: translates the unified-semantics QueryOptions into an engine query language.
 *
 * Engine implementations:
 * - FluxQueryBuilder (InfluxDB 2, Flux)
 * - Influxdb3SqlQueryBuilder (InfluxDB 3 Core, DataFusion SQL)
 * - TdengineSqlQueryBuilder (TDengine, TDengine SQL dialect)
 *
 * @param options unified query semantics
 * @param isolation project isolation unit (v2=bucket name, v3/TDengine=database name)
 */
export interface QueryBuilder {
  buildQuery(options: QueryOptions, isolation: { name: string }): string;
}
