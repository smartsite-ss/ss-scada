// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { DataPoint } from '@ss-node/ss-storage';

/**
 * InfluxDB 2 Flux CSV response parser (result normalization).
 *
 * Extracted from InfluxdbAdapterService.parseCsvResponse(); parsing logic unchanged:
 * - skip annotation lines starting with #;
 * - take values by the _time/tagId/deviceId/projectId/value/value_text/quality columns;
 * - when the value column is missing, fall back to value_text (§5.1 non-numeric split convention).
 */
export class FluxCsvParser {
  parse(csvText: string): DataPoint[] {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    // Locate the header row (skipping annotation lines starting with #)
    let headerIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#')) {
        headerIndex = i;
        break;
      }
    }

    const headers = lines[headerIndex].split(',');
    const dataLines = lines.slice(headerIndex + 1).filter((line) => line.trim() !== '');

    const timeIndex = headers.findIndex((header) => header === '_time');
    const tagIdIndex = headers.findIndex((header) => header === 'tagId');
    const deviceIdIndex = headers.findIndex((header) => header === 'deviceId');
    const projectIdIndex = headers.findIndex((header) => header === 'projectId');
    const valueIndex = headers.findIndex((header) => header === 'value');
    const valueTextIndex = headers.findIndex((header) => header === 'value_text');
    const qualityIndex = headers.findIndex((header) => header === 'quality');

    return dataLines.map((line) => {
      const columns = line.split(',');
      const getColumnValue = (index: number) =>
        index >= 0 && index < columns.length ? columns[index] : '';

      // value takes numeric first; falls back to value_text when missing (non-numeric points)
      const rawValue = getColumnValue(valueIndex);
      const fallbackText = getColumnValue(valueTextIndex);
      const value: number | string =
        rawValue !== '' ? parseFloat(rawValue) || rawValue : fallbackText;

      return {
        tagId: getColumnValue(tagIdIndex),
        deviceId: getColumnValue(deviceIdIndex),
        projectId: getColumnValue(projectIdIndex),
        value,
        timestamp: new Date(getColumnValue(timeIndex)),
        quality: parseInt(getColumnValue(qualityIndex), 10) || 0,
      };
    });
  }
}
