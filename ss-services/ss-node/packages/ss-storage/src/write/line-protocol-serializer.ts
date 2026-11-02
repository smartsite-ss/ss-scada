// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { DataPoint } from '../interfaces/storage-adapter.interface';

/**
 * Line Protocol serializer (shared by v2 / v3 / TDengine).
 *
 * Payload format (extracted from InfluxdbAdapterService.sendToInfluxDB):
 * - measurement: tag_values
 * - tags: tagId / deviceId / projectId
 * - fields: value / value_text / quality / metadata(JSON)
 * - timestamp: nanoseconds (precision=ns)
 *
 * value type constraint (write contract, §5.1/§8.3):
 * Within the same shard, a Line Protocol field can only hold a single type.
 * The convention is that value is numeric-first (number); non-numeric values (string / boolean) go to a separate
 * value_text field, and mixing types in the same field is forbidden. On the TDengine side value is fixed DOUBLE;
 * in strict mode mixed types error out directly, and the serialization layer splits the flow uniformly here.
 */

function escapeTagValue(value: string): string {
  return value.replace(/[,= ]/g, '\\$&');
}

function escapeFieldValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

/** Serialization options */
export interface SerializeLineProtocolOptions {
  /**
   * Skip string fields (value_text / metadata).
   * InfluxDB 3 Core does not support string field values (P0 test: writes fail with
   * "No fields were provided", and also fail the numeric fields on the same line),
   * so it must be enabled when writing to the v3 engine; kept off for v2 / TDengine.
   */
  skipStringFields?: boolean;
}

export function serializeLineProtocol(
  points: DataPoint[],
  options: SerializeLineProtocolOptions = {},
): string {
  return points
    .map((point) => {
      const measurement = 'tag_values';
      const tags: Record<string, string> = {
        tagId: point.tagId,
        deviceId: point.deviceId,
        projectId: point.projectId,
      };
      const tagStr = Object.entries(tags)
        .map(([tagName, tagValue]) => `${tagName}=${escapeTagValue(String(tagValue))}`)
        .join(',');

      // Type split: numeric goes to value, non-numeric to value_text, avoiding mixed types in one field;
      // v3 (skipStringFields) does not support string fields; non-numeric values skip that field entirely
      const fields: Record<string, number | string | boolean> = {};
      if (typeof point.value === 'number') {
        fields.value = point.value;
      } else if (!options.skipStringFields) {
        if (typeof point.value === 'boolean') {
          fields.value_text = point.value ? 'true' : 'false';
        } else {
          fields.value_text = String(point.value);
        }
      }
      fields.quality = point.quality;
      if (point.metadata && !options.skipStringFields) {
        fields.metadata = JSON.stringify(point.metadata);
      }
      const fieldStr = Object.entries(fields)
        .map(([fieldName, fieldValue]) => {
          if (typeof fieldValue === 'string') {
            return `${fieldName}="${escapeFieldValue(fieldValue)}"`;
          }
          return `${fieldName}=${fieldValue}`;
        })
        .join(',');

      const timestampNanoseconds = point.timestamp ? ` ${point.timestamp.getTime() * 1000000}` : '';

      return `${measurement},${tagStr} ${fieldStr}${timestampNanoseconds}`;
    })
    .join('\n');
}
