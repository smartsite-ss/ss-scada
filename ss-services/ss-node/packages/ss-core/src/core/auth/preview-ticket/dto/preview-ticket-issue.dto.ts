// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Preview-ticket issue request (Plan C: backend assembles the full shell URL by SCADA_SHELL_BASE_URL).
 * All fields are optional: only used to assemble previewUrl, not affecting the ticket's own validity.
 */
export class PreviewTicketIssueDto {
  @ApiPropertyOptional({ description: '项目标识符（projectId，用于拼装预览 URL）' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: '画面名称（pageName）' })
  @IsOptional()
  @IsString()
  pageName?: string;

  @ApiPropertyOptional({ description: '分组名称（group）' })
  @IsOptional()
  @IsString()
  group?: string;
}
