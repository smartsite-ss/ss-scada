// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

/** Raw tag data parsed from Excel */
export interface ParsedTagRow {
  rowIndex: number;
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
  [key: string]: any;
}

/** Excel parsing configuration */
export interface ExcelParseOptions {
  /** Worksheet name (reads the first one by default) */
  sheetName?: string;
  /** Header row number (0-based, default 0 i.e. the first row) */
  headerRow?: number;
  /** Data start row number (0-based, default headerRow + 1) */
  dataStartRow?: number;
  /** Column name mapping: Excel column name → tag field name */
  columnMapping?: Record<string, string>;
}

/** Default column name mapping */
const DEFAULT_COLUMN_MAPPING: Record<string, string> = {
  名称: 'name',
  name: 'name',
  变量名: 'name',
  tagName: 'name',
  地址: 'address',
  address: 'address',
  寄存器地址: 'address',
  数据类型: 'dataType',
  dataType: 'dataType',
  data_type: 'dataType',
  类型: 'dataType',
  描述: 'description',
  description: 'description',
  单位: 'unit',
  unit: 'unit',
  工程单位: 'unit',
  最小值: 'minValue',
  minValue: 'minValue',
  min: 'minValue',
  最大值: 'maxValue',
  maxValue: 'maxValue',
  max: 'maxValue',
  采集频率: 'scanRate',
  scanRate: 'scanRate',
  scan_rate: 'scanRate',
  启用: 'enabled',
  enabled: 'enabled',
  是否启用: 'enabled',
  分类: 'category',
  category: 'category',
};

/** List of required field names */
const REQUIRED_FIELDS = ['name', 'address', 'dataType'];

@Injectable()
export class TagExcelParserService {
  private readonly logger = new Logger(TagExcelParserService.name);

  /**
   * Parse an Excel file Buffer, returning an array of tag data
   */
  parse(buffer: Buffer, options: ExcelParseOptions = {}): ParsedTagRow[] {
    const workbook = this.readWorkbook(buffer);
    const sheetName = options.sheetName ?? workbook.SheetNames[0];

    if (!sheetName || !workbook.Sheets[sheetName]) {
      throw new BadRequestException('Excel 文件中未找到有效工作表');
    }

    const sheet = workbook.Sheets[sheetName];
    const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (rawData.length === 0) {
      throw new BadRequestException('Excel 工作表为空');
    }

    const headerRow = options.headerRow ?? 0;
    const dataStartRow = options.dataStartRow ?? headerRow + 1;
    const columnMapping = options.columnMapping ?? DEFAULT_COLUMN_MAPPING;

    // Read the header
    const headerRowData = rawData[headerRow];
    if (!headerRowData || headerRowData.length === 0) {
      throw new BadRequestException('Excel 表头行无效');
    }

    // Build the column index mapping: column index → tag field name
    const colIndexMap: Record<number, string> = {};
    for (let i = 0; i < headerRowData.length; i++) {
      const colName = String(headerRowData[i] ?? '').trim();
      const mappedField = columnMapping[colName];
      if (mappedField) {
        colIndexMap[i] = mappedField;
      }
    }

    // Validate that the columns for required fields exist
    const mappedFields = new Set(Object.values(colIndexMap));
    const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
    if (missingRequired.length > 0) {
      throw new BadRequestException(
        `Excel 表头缺少必填字段对应的列: ${missingRequired.join(', ')}。` +
          `已识别的列: ${[...mappedFields].join(', ')}`,
      );
    }

    // Parse data rows
    const tags: ParsedTagRow[] = [];

    for (let rowIdx = dataStartRow; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.every((cell: any) => String(cell ?? '').trim() === '')) {
        continue; // skip empty rows
      }

      const tag: ParsedTagRow = { rowIndex: rowIdx + 1, name: '', address: '', dataType: '' };

      for (const [colIdx, fieldName] of Object.entries(colIndexMap)) {
        const colIndex = Number(colIdx);
        const rawValue = row[colIndex];
        tag[fieldName] = this.normalizeValue(fieldName, rawValue);
      }

      // Skip rows with an empty name
      if (!tag.name || String(tag.name).trim() === '') {
        continue;
      }

      tags.push(tag);
    }

    this.logger.log(`Excel 解析完成: 共 ${tags.length} 个标签`);
    return tags;
  }

  /**
   * Read the workbook
   */
  private readWorkbook(buffer: Buffer): XLSX.WorkBook {
    try {
      return XLSX.read(buffer, { type: 'buffer' });
    } catch (error: any) {
      throw new BadRequestException(`无法解析 Excel 文件: ${error.message}`);
    }
  }

  /**
   * Normalize a value by field name
   */
  private normalizeValue(fieldName: string, rawValue: any): any {
    if (rawValue === undefined || rawValue === null) {
      return fieldName === 'minValue' || fieldName === 'maxValue' ? null : '';
    }

    const strValue = String(rawValue).trim();

    switch (fieldName) {
      case 'name':
      case 'address':
      case 'dataType':
      case 'description':
      case 'unit':
      case 'category':
        return strValue;
      case 'minValue':
      case 'maxValue': {
        if (strValue === '' || strValue === '-') return null;
        const num = Number(strValue);
        return isNaN(num) ? null : num;
      }
      case 'scanRate': {
        const num = Number(strValue);
        return isNaN(num) ? undefined : num;
      }
      case 'enabled': {
        const lower = strValue.toLowerCase();
        if (lower === 'true' || lower === '是' || lower === 'yes' || lower === '1') return true;
        if (lower === 'false' || lower === '否' || lower === 'no' || lower === '0') return false;
        return true; // enabled by default
      }
      default:
        return strValue;
    }
  }
}
