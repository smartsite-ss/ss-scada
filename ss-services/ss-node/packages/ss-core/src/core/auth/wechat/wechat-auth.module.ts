// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth.module';
import { WechatAuthService } from './wechat-auth.service';
import { WechatAuthController } from './wechat-auth.controller';
import { WechatMpAuthService } from './wechat-mp-auth.service';
import { WechatMpAuthController } from './wechat-mp-auth.controller';
import { WechatApiService } from './wechat-api.service';
import { WechatStateService } from './wechat-state.service';
import { ProjectAuthorization } from '../../user/entities/project-authorization.entity';

/**
 * WeChat scan-login module
 *
 * Registration: registered independently in app.module.ts's sharedModules (after AuthModule).
 *
 * Dependencies:
 *   - imports: [AuthModule] -- explicitly imported to inject AuthService (AuthModule is not @Global,
 *             must be explicitly imported to inject AuthService into WechatAuthService.
 *             AuthModule does not import WechatAuthModule in return, so no circular dependency)
 *   - @Global modules auto-available: RedisModule (REDIS_CLIENT_DEFAULT),
 *     UserModule (UserService), AuditLoggerModule (AuditLoggerService),
 *     I18nModule (I18nService)
 *   - providers: WechatAuthService, WechatApiService, WechatStateService
 *   - controllers: WechatAuthController
 *   - exports: WechatAuthService
 */
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([ProjectAuthorization])],
  controllers: [WechatAuthController, WechatMpAuthController],
  providers: [WechatAuthService, WechatMpAuthService, WechatApiService, WechatStateService],
  exports: [WechatAuthService, WechatMpAuthService],
})
export class WechatAuthModule {}
