// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { DataPoint } from '@ss-node/ss-storage';

/** TDengine REST SQL response (/rest/sql) */
interface TdengineRestResponse {
  status: string;
  code: number;
  message?: string;
  /** Column metadata: [[name, type, bytes], ...] */
  column_meta?: [string, string, number][];
  /** Row data: order matches column_meta */
  data?: unknown[][];
  rows?: number;
}

/**
 * TDengine REST SQL result JSON parser (result normalization).
 *
 * - Raw response: { status, code, column_meta (column name array), data (row array), rows };
 * - throws when status !== 'succ' (carrying code/message);
 * - column mapping: ts/window_start → timestamp, value/value_text → value (numeric first);
 * - empty-window rows produced by FILL(NULL) (value null) are skipped, aligned with the v2 raw "skip empty windows" semantics;
 * - aggregated results do not contain quality (§6.3 quality aggregation semantics); quality is set to 0 during normalization.
 */
export class TdengineJsonParser {
  parse(rawText: string): DataPoint[] {
    const parsed = JSON.parse(rawText) as TdengineRestResponse;

    if (parsed.status !== 'succ') {
      throw new Error(
        `TDengine query failed (code ${parsed.code}): ${parsed.message || 'unknown error'}`,
      );
    }

    const columnMeta = parsed.column_meta || [];
    const dataRows = parsed.data || [];
    if (columnMeta.length === 0 || dataRows.length === 0) {
      return [];
    }

    const columnIndex = new Map(
      columnMeta.map(([columnName], index) => [columnName, index] as [string, number]),
    );

    return dataRows
      .map((row) => {
        const record: Record<string, unknown> = {};
        for (const [columnName, index] of columnIndex.entries()) {
          record[columnName] = row[index];
        }
        return this.normalizeRecord(record);
      })
      .filter((dataPoint) => dataPoint !== null);
  }

  // ──────────── Internal methods ────────────

  private normalizeRecord(record: Record<string, unknown>): DataPoint | null {
    const timestampValue = record['ts'] ?? record['window_start'];
    if (timestampValue === undefined || timestampValue === null) {
      return null;
    }

    // FILL(NULL) empty-window row: value/value_text both empty → skip (aligned with v2 raw's skip-empty-window semantics)
    const numericValue = record['value'];
    const textValue = record['value_text'];
    if (
      (numericValue === null || numericValue === undefined) &&
      (textValue === null || textValue === undefined)
    ) {
      return null;
    }

    // value takes numeric first; falls back to value_text when missing (§5.1 non-numeric split convention)
    let value: number | string;
    if (typeof numericValue === 'number') {
      value = numericValue;
    } else if (typeof textValue === 'string' && textValue !== '') {
      value = textValue;
    } else {
      value = String(numericValue ?? '');
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
