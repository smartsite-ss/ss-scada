// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Mini-program WeChat login request (code from wx.login, 5-minute validity) */
export class WechatMpLoginDto {
  @ApiProperty({ description: '微信登录临时凭证（wx.login code）' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  loginCode: string;
}

/** Mini-program account-password login request (does not depend on WeChat code, uses system account/password directly) */
export class WechatMpPasswordLoginDto {
  @ApiProperty({ description: '系统账号用户名' })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({ description: '系统账号密码' })
  @IsString()
  @MinLength(1)
  password: string;
}

/** Mini-program account-binding request (fetch a fresh loginCode at submit time to avoid expiration from lingering) */
export class WechatMpBindAccountDto {
  @ApiProperty({ description: '微信登录临时凭证（wx.login code）' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  loginCode: string;

  @ApiProperty({ description: '系统账号用户名' })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({ description: '系统账号密码' })
  @IsString()
  @MinLength(1)
  password: string;
}
