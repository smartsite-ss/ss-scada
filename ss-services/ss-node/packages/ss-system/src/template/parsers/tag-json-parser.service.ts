// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, BadRequestException } from '@nestjs/common';

/** Raw tag data parsed from JSON */
export interface ParsedJsonTag {
  name: string;
  address: string;
  dataType: string;
  description?: string;
  unit?: string;
  minValue?: number | null;
  maxValue?: number | null;
  scanRate?: number;
  enabled?: boolean;
  category?: string;
  order?: number;
  [key: string]: any;
}

/** JSON parsing result */
export interface JsonParseResult {
  tags: ParsedJsonTag[];
  /** If the format is an object, keep the metadata */
  metadata?: {
    schemaVersion?: string;
    templateType?: string;
    name?: string;
    description?: string;
    deviceType?: string;
    version?: string;
  };
}

@Injectable()
export class TagJsonParserService {
  private readonly logger = new Logger(TagJsonParserService.name);

  /**
   * Parse a JSON string, returning tag data
   * Supports two formats:
   *   1. Array format: [{name, address, dataType, ...}, ...]
   *   2. Object format: { tags: [...], name, deviceType, ... }
   */
  parse(jsonString: string): JsonParseResult {
    let parsed: any;

    try {
      parsed = JSON.parse(jsonString);
    } catch (error: any) {
      throw new BadRequestException(`JSON 解析失败: ${error.message}`);
    }

    if (parsed === null || parsed === undefined) {
      throw new BadRequestException('JSON 数据为空');
    }

    // Array format
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        throw new BadRequestException('JSON 标签数组为空');
      }
      return {
        tags: parsed.map((item, index) => this.normalizeTag(item, index)),
      };
    }

    // Object format
    if (typeof parsed === 'object') {
      // Supports the tags field
      if (Array.isArray(parsed.tags)) {
        if (parsed.tags.length === 0) {
          throw new BadRequestException('JSON 中 tags 数组为空');
        }
        return {
          tags: parsed.tags.map((item: any, index: number) => this.normalizeTag(item, index)),
          metadata: {
            schemaVersion: parsed.schemaVersion,
            templateType: parsed.templateType,
            name: parsed.name,
            description: parsed.description,
            deviceType: parsed.deviceType,
            version: parsed.version,
          },
        };
      }

      // Supports the variables field (same as the template's internal format)
      if (Array.isArray(parsed.variables)) {
        if (parsed.variables.length === 0) {
          throw new BadRequestException('JSON 中 variables 数组为空');
        }
        return {
          tags: parsed.variables.map((item: any, index: number) => this.normalizeTag(item, index)),
          metadata: {
            schemaVersion: parsed.schemaVersion,
            templateType: parsed.templateType,
            name: parsed.name,
            description: parsed.description,
            deviceType: parsed.deviceType,
            version: parsed.version,
          },
        };
      }

      throw new BadRequestException(
        'JSON 格式不支持：期望数组格式或包含 tags/variables 字段的对象格式',
      );
    }

    throw new BadRequestException('JSON 格式不支持：期望数组或对象类型');
  }

  /**
   * Normalize a single tag's data
   */
  private normalizeTag(item: any, index: number): ParsedJsonTag {
    if (typeof item !== 'object' || item === null) {
      throw new BadRequestException(`JSON 第 ${index + 1} 个标签数据格式无效，期望对象类型`);
    }

    const tag: ParsedJsonTag = {
      name: String(item.name ?? item.tagName ?? ''),
      address: String(item.address ?? ''),
      dataType: String(item.dataType ?? item.data_type ?? ''),
      description: item.description ? String(item.description) : undefined,
      unit: item.unit ? String(item.unit) : undefined,
      minValue:
        item.minValue !== undefined && item.minValue !== null ? Number(item.minValue) : undefined,
      maxValue:
        item.maxValue !== undefined && item.maxValue !== null ? Number(item.maxValue) : undefined,
      scanRate: item.scanRate !== undefined ? Number(item.scanRate) : undefined,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : undefined,
      category: item.category ? String(item.category) : undefined,
      order: item.order !== undefined ? Number(item.order) : index + 1,
    };

    // Keep other fields
    const knownFields = new Set([
      'name',
      'tagName',
      'address',
      'dataType',
      'data_type',
      'description',
      'unit',
      'minValue',
      'maxValue',
      'scanRate',
      'enabled',
      'category',
      'order',
    ]);
    for (const key of Object.keys(item)) {
      if (!knownFields.has(key)) {
        tag[key] = item[key];
      }
    }

    return tag;
  }
}
