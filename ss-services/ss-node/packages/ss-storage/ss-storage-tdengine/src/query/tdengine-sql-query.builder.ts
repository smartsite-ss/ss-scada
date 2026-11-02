// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { QueryBuilder, QueryOptions } from '@ss-node/ss-storage';

/**
 * TDengine SQL query dialect builder (different from v3's DataFusion SQL syntax; implemented independently).
 *
 * - Window aggregation: INTERVAL(...) instead of DATE_BIN; function names AVG/MAX/MIN/SUM/COUNT are the same;
 * - Empty-window filling: the FILL clause — raw→FILL(NULL), step→FILL(PREV), linear→FILL(LINEAR);
 * - Super-table partitioned by tagId: PARTITION BY tagId (tags are TAG columns, directly selectable/filterable);
 * - Time column: ts (TIMESTAMP primary key column); time conditions use ISO8601 string literals;
 * - Strict mode: value is fixed DOUBLE; non-numeric values go to value_text (§5.1/§7.4.2 split convention);
 * - Injection protection: values are always escaped via escapeSqlLiteral (doubled single quotes);
 *   REST stmt parameter binding availability awaits P0 testing; switch to parameter binding once it passes;
 * - Timezone alignment: INTERVAL defaults to the server timezone; consistency with local UTC+8 awaits P0 testing (§6.3).
 */
export class TdengineSqlQueryBuilder implements QueryBuilder {
  buildQuery(options: QueryOptions, _isolation: { name: string }): string {
    const aggregation = options.aggregation;
    return aggregation
      ? this.buildAggregationQuery(options, aggregation)
      : this.buildRawQuery(options);
  }

  // ──────────── Raw point queries ────────────

  private buildRawQuery(options: QueryOptions): string {
    let sql =
      'SELECT ts, tagId, deviceId, projectId, value, value_text, quality\n' +
      `FROM ${this.supertableReference(options)}`;

    const conditions = this.buildConditions(options);
    if (conditions.length > 0) {
      sql += `\nWHERE ${conditions.join(' AND ')}`;
    }

    sql += `\nORDER BY ts ${options.order === 'desc' ? 'DESC' : 'ASC'}`;

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
    const aggregateFunction = this.translateAggregateFunction(aggregation.function);
    const interpolation = options.interpolation || 'raw';

    // No window interval: whole-range scalar aggregation (grouped by tagId)
    if (!aggregation.interval) {
      let sql =
        `SELECT tagId, ${aggregateFunction}(value) AS value\n` +
        `FROM ${this.supertableReference(options)}`;
      const conditions = this.buildConditions(options);
      if (conditions.length > 0) {
        sql += `\nWHERE ${conditions.join(' AND ')}`;
      }
      sql += `\nGROUP BY tagId`;
      return sql + ';';
    }

    const intervalExpression = this.translateInterval(aggregation.interval);
    const fillClause =
      interpolation === 'linear'
        ? 'FILL(LINEAR)'
        : interpolation === 'step'
          ? 'FILL(PREV)'
          : 'FILL(NULL)';

    let sql =
      `SELECT _wstart AS window_start, tagId, ${aggregateFunction}(value) AS value\n` +
      `FROM ${this.supertableReference(options)}`;

    const conditions = this.buildConditions(options);
    if (conditions.length > 0) {
      sql += `\nWHERE ${conditions.join(' AND ')}`;
    }

    // Super-table window aggregation must partition by tagId, then open an INTERVAL window + FILL
    sql += `\nPARTITION BY tagId INTERVAL(${intervalExpression}) ${fillClause}`;
    sql += `\nORDER BY window_start ${options.order === 'desc' ? 'DESC' : 'ASC'}`;

    if (options.limit) {
      sql += `\nLIMIT ${this.sanitizeInteger(options.limit)}`;
    }

    return sql + ';';
  }

  // ──────────── Condition building ────────────

  private buildConditions(options: QueryOptions): string[] {
    const conditions: string[] = [];

    if (options.startTime) {
      conditions.push(`ts >= ${this.escapeSqlLiteral(options.startTime.toISOString())}`);
    }
    if (options.endTime) {
      conditions.push(`ts <= ${this.escapeSqlLiteral(options.endTime.toISOString())}`);
    }
    if (options.tagIds && options.tagIds.length > 0) {
      const tagIdList = options.tagIds.map((tagId) => this.escapeSqlLiteral(tagId)).join(', ');
      conditions.push(`tagId IN (${tagIdList})`);
    }
    if (options.deviceIds && options.deviceIds.length > 0) {
      const deviceIdList = options.deviceIds
        .map((deviceId) => this.escapeSqlLiteral(deviceId))
        .join(', ');
      conditions.push(`deviceId IN (${deviceIdList})`);
    }

    return conditions;
  }

  // ──────────── Dialect translation ────────────

  /** TDengine INTERVAL directly accepts '5m'/'1h'/'1d' etc. (passed through after whitelist validation) */
  private translateInterval(interval: string): string {
    const trimmed = interval.trim();
    if (!/^\d+[smhdwy]$/.test(trimmed)) {
      throw new Error(`Invalid TDengine interval expression: ${interval}`);
    }
    return trimmed;
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

  /** Super-table reference: fixed tag_values within the same database (isolation is handled by the database) */
  private supertableReference(_options: QueryOptions): string {
    return 'tag_values';
  }
}
