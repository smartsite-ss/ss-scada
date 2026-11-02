// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Mock scan request DTO
 *
 * Only available when WECHAT_MOCK=true, simulating a user confirming/cancelling a phone scan
 */
export class WechatMockScanDto {
  @ApiProperty({ description: 'state 参数（来自 /qrcode 接口返回）', example: 'abc123def456' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({
    description: '扫码动作：confirm（确认登录）| cancel（取消）',
    enum: ['confirm', 'cancel'],
    example: 'confirm',
  })
  @IsIn(['confirm', 'cancel'])
  action: 'confirm' | 'cancel';
}
