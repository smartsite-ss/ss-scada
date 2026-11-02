// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { QueryBuilder, QueryOptions } from '@ss-node/ss-storage';

/**
 * Flux query dialect builder (InfluxDB 2).
 *
 * Extracted from InfluxdbAdapterService.buildFluxQuery(); statement structure unchanged:
 * from(bucket) |> range |> filter(measurement) |> filter(tagIds) |> filter(field)
 *   [|> aggregateWindow / aggregation] [|> interpolate.linear / fill] |> sort |> limit |> pivot
 *
 * Interpolation mapping (§6.2):
 * - raw: aggregateWindow(createEmpty: false), empty windows skipped (status quo);
 * - linear: aggregateWindow(createEmpty: true) |> interpolate.linear(every);
 * - step: aggregateWindow(createEmpty: true) |> fill(usePrevious: true).
 */
export class FluxQueryBuilder implements QueryBuilder {
  buildQuery(options: QueryOptions, isolation: { name: string }): string {
    const { tagIds, deviceIds, startTime, endTime, limit, offset, order, aggregation, interpolation } =
      options;

    let query = `from(bucket: "${isolation.name}")`;

    // Time range
    const start = startTime ? startTime.toISOString() : '-30d';
    const stop = endTime ? endTime.toISOString() : 'now()';
    query += `\n  |> range(start: ${start}, stop: ${stop})`;

    // measurement filter
    query += `\n  |> filter(fn: (r) => r["_measurement"] == "tag_values")`;

    // tagId filter
    if (tagIds && tagIds.length > 0) {
      const tagFilters = tagIds.map((id) => `r["tagId"] == "${id}"`).join(' or ');
      query += `\n  |> filter(fn: (r) => ${tagFilters})`;
    }

    // deviceId filter
    if (deviceIds && deviceIds.length > 0) {
      const deviceFilters = deviceIds.map((id) => `r["deviceId"] == "${id}"`).join(' or ');
      query += `\n  |> filter(fn: (r) => ${deviceFilters})`;
    }

    // field filter
    query += `\n  |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "value_text" or r["_field"] == "quality")`;

    // Aggregation + interpolation
    if (aggregation) {
      const windowDuration = aggregation.interval ? this.parseInterval(aggregation.interval) : '';
      if (windowDuration) {
        const createEmpty = interpolation === 'linear' || interpolation === 'step';
        query += `\n  |> aggregateWindow(every: ${windowDuration}, fn: ${aggregation.function}, createEmpty: ${createEmpty})`;
        if (interpolation === 'linear') {
          query += `\n  |> interpolate.linear(every: ${windowDuration})`;
        } else if (interpolation === 'step') {
          query += `\n  |> fill(usePrevious: true)`;
        }
      } else {
        const functionMap: Record<string, string> = {
          avg: 'mean',
          max: 'max',
          min: 'min',
          sum: 'sum',
          count: 'count',
        };
        query += `\n  |> ${functionMap[aggregation.function] || aggregation.function}()`;
      }
    }

    // Sorting
    if (order) {
      query += `\n  |> sort(columns: ["_time"], desc: ${order === 'desc'})`;
    }

    // Pagination
    if (limit) {
      query += `\n  |> limit(n: ${limit}, offset: ${offset || 0})`;
    }

    // Row/column pivot
    query += `\n  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")`;

    return query;
  }

  private parseInterval(interval: string): string {
    const supportedIntervals: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '1h': '1h',
      '6h': '6h',
      '1d': '1d',
    };
    return supportedIntervals[interval] || interval;
  }
}
