// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceStatus, DeviceType, PaginationDto } from '@ss-node/ss-sdk';

export class QueryDeviceDto extends PaginationDto {
  @ApiPropertyOptional({ description: '按项目过滤' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: '按设备编码精确匹配' })
  @IsString()
  @IsOptional()
  deviceCode?: string;

  @ApiPropertyOptional({ description: '按状态过滤', enum: DeviceStatus })
  @IsEnum(DeviceStatus)
  @IsOptional()
  status?: DeviceStatus | 'all';

  @ApiPropertyOptional({ description: '按类型过滤', enum: DeviceType })
  @IsEnum(DeviceType)
  @IsOptional()
  type?: DeviceType;

  @ApiPropertyOptional({ description: '按分组过滤' })
  @IsString()
  @IsOptional()
  groupId?: string;

  @ApiPropertyOptional({
    description: '按多个分组过滤（逗号分隔或重复参数），用于选择父分组时包含所有子分组',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value.map((item) => String(item));
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  })
  @IsArray()
  @IsString({ each: true })
  groupIds?: string[];

  @ApiPropertyOptional({ description: '模糊匹配 deviceName/deviceCode/nameAlias' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: '排序字段',
    enum: ['deviceName', 'deviceCode', 'status', 'createdAt', 'updatedAt'],
  })
  @IsString()
  @IsOptional()
  sortBy?: 'deviceName' | 'deviceCode' | 'status' | 'createdAt' | 'updatedAt';
}
