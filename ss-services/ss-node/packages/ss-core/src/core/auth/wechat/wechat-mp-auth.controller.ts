// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Controller, Post, Body, Req, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { WechatMpAuthService } from './wechat-mp-auth.service';
import { WechatMpLoginDto, WechatMpBindAccountDto, WechatMpPasswordLoginDto } from './dto/wechat-mp-auth.dto';
import { Public } from '../decorators/public.decorator';

/** User payload mounted by the guard after JWT auth (written by JwtStrategy) */
interface AuthenticatedRequest extends Request {
  user: { id: string; username: string; role: string };
}

/**
 * Mini-program WeChat login Controller (01 - account & auth)
 *
 * Route prefix: /auth/wechat (shares the prefix with scan login; endpoints do not conflict)
 *
 * Endpoints:
 *   1. POST /login            wx.login code -> bound issues dual token / unbound guides to account-password binding
 *   2. POST /bind              account-password binding (fresh code at submit) + issue dual token
 *   3. POST /login-password    account-password login (does not depend on WeChat code, uses system account/password)
 *   4. POST /unbind            unbind (requires login, Bearer accessToken)
 *
 * Mini-programs have no Cookie capability; Token is always delivered via response body (Bearer mode),
 * consistent with the desktop Tauri delivery strategy, not via setAuthCookies.
 */
@ApiTags('认证')
@Controller('auth/wechat')
export class WechatMpAuthController {
  private readonly logger = new Logger(WechatMpAuthController.name);

  constructor(private readonly wechatMpAuthService: WechatMpAuthService) {}

  /** Extract client IP from the request (supports proxy-forwarding, consistent with AuthController) */
  private getClientIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      req.socket?.remoteAddress ||
      'unknown'
    );
  }

  /** 1. Mini-program WeChat login (public, rate-limited to prevent brute force) */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: '小程序微信登录（code2session，未绑定时引导账密绑定）' })
  async login(@Body() dto: WechatMpLoginDto, @Req() req: Request) {
    const result = await this.wechatMpAuthService.login(dto.loginCode, {
      ip: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    this.logger.log(
      `[POST /auth/wechat/login] Mini-program login response | bindingRequired=${result.bindingRequired} authenticated=${result.tokenPair !== null}`,
    );
    return result;
  }

  /** 2. Account-password binding and login (public, rate-limited to prevent password brute force) */
  @Post('bind')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: '小程序账号绑定（微信 openid 绑定系统账号并签发 Token）' })
  async bind(@Body() dto: WechatMpBindAccountDto, @Req() req: Request) {
    return this.wechatMpAuthService.bind(dto.loginCode, dto.username, dto.password, {
      ip: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
  }

  /** 3. Mini-program account-password login (public, rate-limited to prevent password brute force) */
  @Post('login-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: '小程序账密登录（系统账号密码直接登录，不依赖微信 code）' })
  async loginWithPassword(@Body() dto: WechatMpPasswordLoginDto, @Req() req: Request) {
    const result = await this.wechatMpAuthService.loginWithPassword(dto.username, dto.password, {
      ip: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    this.logger.log(
      `[POST /auth/wechat/login-password] Password login response | userId="${result.userInformation.userId}" username="${result.userInformation.username}"`,
    );
    return result;
  }

  /** 4. Unbind the current logged-in user's mini-program WeChat (requires login) */
  @Post('unbind')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '解除小程序微信绑定（需登录）' })
  async unbind(@Req() req: AuthenticatedRequest) {
    return this.wechatMpAuthService.unbind(req.user.id, {
      ip: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
  }
}
