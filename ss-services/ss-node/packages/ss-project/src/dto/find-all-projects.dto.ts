// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@ss-node/ss-sdk';

/**
 * Project-list query DTO
 *
 * Extends the pagination params (page/pageSize/keyword/sortBy/sortOrder),
 * adding the `includeDisabled` field to pass the global ValidationPipe's forbidNonWhitelisted validation.
 *
 * - The project-management page passes includeDisabled=true to view all projects (including disabled), for toggling the enabled state
 * - Operational scenarios like device management / home statistics / editor omit it (default false), seeing only enabled projects
 */
export class FindAllProjectsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: '是否包含停用项目（项目管理页传 true 查看全部；设备管理/首页/编辑器默认 false 仅看启用）',
    example: true,
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  includeDisabled?: boolean;
}
