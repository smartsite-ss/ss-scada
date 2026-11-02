// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Preview-ticket exchange request (the H5 runtime shell exchanges the one-time ticket in the URL for a Cookie session) */
export class PreviewTicketExchangeDto {
  @ApiProperty({ description: '一次性预览票据（60 秒有效，兑换即失效）' })
  @IsString()
  previewTicket: string;
}
