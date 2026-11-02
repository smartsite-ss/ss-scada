// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IsString, IsOptional } from 'class-validator';

/**
 * S-C03: refreshToken is now optional (transported via HttpOnly Cookie in Cookie mode, body may be empty)
 */
export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
