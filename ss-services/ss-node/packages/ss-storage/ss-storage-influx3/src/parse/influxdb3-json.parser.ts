// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { DataPoint } from '@ss-node/ss-storage';

/**
 * InfluxDB 3 Core SQL query JSON response parser (result normalization).
 *
 * Supports three response shapes (the exact shape of v3 format=json is pending P0 test convergence, see plan §11-2):
 * 1. { columns: [...], rows: [[...], ...] } (column names + row arrays)
 * 2. { series: [{ columns: [...], values: [[...], ...] }] } (InfluxQL style)
 * 3. [{ time: ..., tagId: ... }, ...] (array of objects)
 *
 * Column mapping: time/window_start → timestamp, value/value_text → value (numeric first).
 * Aggregated results do not contain quality (§6.3 quality aggregation semantics); quality is set to 0 during normalization.
 */
export class Influxdb3JsonParser {
  parse(rawText: string): DataPoint[] {
    const parsed = JSON.parse(rawText);

    if (Array.isArray(parsed)) {
      return parsed
        .map((record) => this.normalizeRecord(record))
        .filter((dataPoint) => dataPoint !== null);
    }

    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
        return this.parseColumnarRows(parsed.columns, parsed.rows);
      }
      if (Array.isArray(parsed.series)) {
        return parsed.series.flatMap((seriesItem: any) =>
          Array.isArray(seriesItem?.columns) && Array.isArray(seriesItem?.values)
            ? this.parseColumnarRows(seriesItem.columns, seriesItem.values)
            : [],
        );
      }
      // Single object (scalar aggregation etc., no time column) → cannot be normalized to DataPoint, return empty
      return [];
    }

    return [];
  }

  // ──────────── Internal methods ────────────

  private parseColumnarRows(columns: string[], rows: unknown[][]): DataPoint[] {
    const columnIndex = new Map(columns.map((columnName, index) => [columnName, index]));

    return rows
      .map((row) => {
        const record: Record<string, unknown> = {};
        for (const [columnName, index] of columnIndex.entries()) {
          record[columnName] = row[index];
        }
        return this.normalizeRecord(record);
      })
      .filter((dataPoint) => dataPoint !== null);
  }

  private normalizeRecord(record: Record<string, unknown>): DataPoint | null {
    const timestampValue = record['time'] ?? record['window_start'];
    if (timestampValue === undefined || timestampValue === null) {
      return null;
    }

    // value takes numeric first; falls back to value_text when missing (§5.1 non-numeric split convention)
    const numericValue = record['value'];
    const textValue = record['value_text'];
    let value: number | string;
    if (typeof numericValue === 'number') {
      value = numericValue;
    } else if (
      typeof numericValue === 'string' &&
      numericValue.trim() !== '' &&
      !isNaN(Number(numericValue))
    ) {
      value = Number(numericValue);
    } else if (typeof textValue === 'string') {
      value = textValue;
    } else {
      value = String(numericValue ?? textValue ?? '');
    }

    const timestamp =
      timestampValue instanceof Date ? timestampValue : new Date(String(timestampValue));

    return {
      tagId: String(record['tagId'] ?? ''),
      deviceId: String(record['deviceId'] ?? ''),
      projectId: String(record['projectId'] ?? ''),
      value,
      timestamp,
      quality: Number(record['quality'] ?? 0) || 0,
    };
  }
}
