// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { QueryBuilder, QueryOptions } from '@ss-node/ss-storage';

/**
 * InfluxDB 3 Core SQL query dialect builder (DataFusion dialect).
 *
 * P0 test (InfluxDB 3 Core 3.11.2) alignment:
 * - camelCase columns (tagId/deviceId/projectId) must be double-quoted, otherwise they are lower-cased
 *   and fail with a "No field named tagid" schema error;
 * - v3 uses a dynamic schema (columns are created at write time); value_text / metadata do not exist until written,
 *   so raw point queries use SELECT * to avoid referencing nonexistent columns, and the parser normalizes sparse objects;
 * - Multi-project isolation: v3 Core has a 5-database limit (tested 422), so per-project databases are not possible;
 *   instead a shared database + WHERE "projectId" = ... tag filter is used (plan §11 test conclusion);
 * - Raw point query: SELECT * FROM tag_values WHERE ... ORDER BY ... LIMIT ...;
 * - Window aggregation: date_bin(INTERVAL '...', time) + GROUP BY;
 * - Interpolation: date_bin_gapfill + interpolate(...) (linear) / locf(...) (step);
 * - quality aggregation semantics: within an aggregation window quality is a quality-code enum; averaging it has no business meaning,
 *   so aggregated results do not return quality (raw point queries still return the single quality value);
 * - Injection protection: values are always escaped via escapeSqlLiteral (doubled single quotes);
 *   the v3 HTTP API has been tested to support params binding ($1 + {"params":{...}});
 *   the literal-escaping approach is kept for now, with parameter binding as a future optimization.
 */
export class Influxdb3SqlQueryBuilder implements QueryBuilder {
  buildQuery(options: QueryOptions, _isolation: { name: string }): string {
    const aggregation = options.aggregation;
    return aggregation
      ? this.buildAggregationQuery(options, aggregation)
      : this.buildRawQuery(options);
  }

  // ──────────── Raw point queries ────────────

  private buildRawQuery(options: QueryOptions): string {
    // SELECT *: v3 has a dynamic schema; columns never written (value_text/metadata) do not exist,
    // explicit references would fail with a schema error; SELECT * is normalized by the parser as sparse objects
    let sql = 'SELECT *\nFROM tag_values';

    const conditions = this.buildConditions(options);
    if (conditions.length > 0) {
      sql += `\nWHERE ${conditions.join(' AND ')}`;
    }

    sql += `\nORDER BY time ${options.order === 'desc' ? 'DESC' : 'ASC'}`;

    if (options.limit) {
      sql += `\nLIMIT ${this.sanitizeInteger(options.limit)} OFFSET ${this.sanitizeInteger(options.offset || 0)}`;
    }

    return sql + ';';
  }

  // ──────────── Window aggregation queries ────────────

  private buildAggregationQuery(
    options: QueryOptions,
    aggregation: NonNullable<QueryOptions['aggregation']>,
  ): string {
    const intervalExpression = aggregation.interval
      ? this.translateInterval(aggregation.interval)
      : null;
    const aggregateFunction = this.translateAggregateFunction(aggregation.function);

    // No window interval: whole-range scalar aggregation (grouped by tagId)
    if (!intervalExpression) {
      let sql = `SELECT "tagId", ${aggregateFunction}(value) AS value\nFROM tag_values`;
      const conditions = this.buildConditions(options);
      if (conditions.length > 0) {
        sql += `\nWHERE ${conditions.join(' AND ')}`;
      }
      sql += `\nGROUP BY "tagId"`;
      return sql + ';';
    }

    // Window aggregation: use date_bin_gapfill + interpolate/locf when interpolating, date_bin for raw
    const interpolation = options.interpolation || 'raw';
    const windowFunction = interpolation === 'raw' ? 'date_bin' : 'date_bin_gapfill';
    const valueExpression =
      interpolation === 'linear'
        ? `interpolate(${aggregateFunction}(value))`
        : interpolation === 'step'
          ? `locf(${aggregateFunction}(value))`
          : `${aggregateFunction}(value)`;

    let sql =
      `SELECT ${windowFunction}(${intervalExpression}, time) AS window_start,\n` +
      `       "tagId",\n` +
      `       ${valueExpression} AS value\n` +
      `FROM tag_values`;

    const conditions = this.buildConditions(options);
    if (conditions.length > 0) {
      sql += `\nWHERE ${conditions.join(' AND ')}`;
    }

    sql += `\nGROUP BY window_start, "tagId"`;
    sql += `\nORDER BY window_start ${options.order === 'desc' ? 'DESC' : 'ASC'}`;

    if (options.limit) {
      sql += `\nLIMIT ${this.sanitizeInteger(options.limit)} OFFSET ${this.sanitizeInteger(options.offset || 0)}`;
    }

    return sql + ';';
  }

  // ──────────── Condition building ────────────

  private buildConditions(options: QueryOptions): string[] {
    const conditions: string[] = [];

    if (options.projectId) {
      // Shared-database isolation: projectId as a WHERE filter (v3's 5-database limit precludes per-project databases)
      conditions.push(`"projectId" = ${this.escapeSqlLiteral(options.projectId)}`);
    }
    if (options.startTime) {
      conditions.push(`time >= ${this.escapeSqlLiteral(options.startTime.toISOString())}`);
    }
    if (options.endTime) {
      conditions.push(`time <= ${this.escapeSqlLiteral(options.endTime.toISOString())}`);
    }
    if (options.tagIds && options.tagIds.length > 0) {
      const tagIdList = options.tagIds.map((tagId) => this.escapeSqlLiteral(tagId)).join(', ');
      conditions.push(`"tagId" IN (${tagIdList})`);
    }
    if (options.deviceIds && options.deviceIds.length > 0) {
      const deviceIdList = options.deviceIds
        .map((deviceId) => this.escapeSqlLiteral(deviceId))
        .join(', ');
      conditions.push(`"deviceId" IN (${deviceIdList})`);
    }

    return conditions;
  }

  // ──────────── Dialect translation ────────────

  /** '5m' → INTERVAL '5 minutes'（s/m/h/d → seconds/minutes/hours/days） */
  private translateInterval(interval: string): string | null {
    const match = /^(\d+)([smhd])$/.exec(interval.trim());
    if (!match) return null;
    const amount = parseInt(match[1], 10);
    const unitMap: Record<string, [string, string]> = {
      s: ['second', 'seconds'],
      m: ['minute', 'minutes'],
      h: ['hour', 'hours'],
      d: ['day', 'days'],
    };
    const [singular, plural] = unitMap[match[2]];
    return `INTERVAL '${amount} ${amount === 1 ? singular : plural}'`;
  }

  private translateAggregateFunction(functionName: string): string {
    const functionMap: Record<string, string> = {
      avg: 'AVG',
      max: 'MAX',
      min: 'MIN',
      sum: 'SUM',
      count: 'COUNT',
    };
    return functionMap[functionName] || functionName.toUpperCase();
  }

  // ──────────── Injection protection ────────────

  /** SQL string literal escaping: single quotes doubled, blocking injections like `a'b";DROP` */
  private escapeSqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  /** Numeric whitelist validation: only non-negative integers allowed (limit/offset) */
  private sanitizeInteger(value: number): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid integer parameter for SQL: ${value}`);
    }
    return parsed;
  }
}
