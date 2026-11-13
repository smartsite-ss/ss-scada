// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { WechatAuthService } from './wechat-auth.service';
import { WechatMockScanDto } from './dto/wechat-mock-scan.dto';

/**
 * WeChat scan-login Controller
 *
 * Route prefix: /api/v1/auth/wechat (inherits the global /api/v1; the AuthController parent /auth does not apply, mounted directly under /auth/wechat)
 *
 * Endpoints:
 *   1. POST /qrcode        generate QR code (returns state + wechatUrl + mock flag)
 *   2. GET  /status?state=  query scan status (frontend polls; on confirmed, issue Cookie)
 *   3. GET  /callback       WeChat callback (real mode, WeChat server redirects here)
 *   4. POST /mock-scan      Mock scan confirm/cancel (only when WECHAT_MOCK=true)
 *
 * Cookie issuance strategy follows S-C03: accessToken path=/ + refreshToken path=/api/v1/auth
 */
@ApiTags('认证')
@Controller('auth/wechat')
export class WechatAuthController {
  private readonly logger = new Logger(WechatAuthController.name);

  private readonly systemBaseUrl: string;

  constructor(private readonly wechatAuthService: WechatAuthService) {
    this.systemBaseUrl = process.env.SYSTEM_BASE_URL || 'http://smartsite.top:8080';
  }

  /** Extract client IP from the request (supports proxy-forwarding, consistent with AuthController) */
  private getClientIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      req.socket?.remoteAddress ||
      'unknown'
    );
  }

  /**
   * S-C03: set HttpOnly + Secure + SameSite=Strict auth Cookies
   *
   * Consistent with AuthController.setAuthCookies (private method cannot be reused directly)
   */
  private setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    const cookieSecure =
      process.env.COOKIE_SECURE !== undefined
        ? process.env.COOKIE_SECURE === 'true'
        : process.env.NODE_ENV === 'production';
    const cookieBase = {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax' as const, // Lax: allows cross-scheme top-level navigation (HTTPS callback to HTTP system home)
    };

    res.cookie('accessToken', accessToken, {
      ...cookieBase,
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });

    res.cookie('refreshToken', refreshToken, {
      ...cookieBase,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/v1/auth',
    });
  }

  /** 1. Generate QR code */
  @Post('qrcode')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: '生成微信扫码登录二维码（Mock/真实双模式）' })
  async generateQrcode(@Req() req: Request) {
    return this.wechatAuthService.generateQrcode({
      ip: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
  }

  /**
   * 2. Poll scan status
   *
   * When status=confirmed, the backend sets the auth Cookies here (one-time)
   * and returns user info; the frontend jumps after receiving it
   */
  @Get('status')
  @Throttle({ default: { ttl: 60000, limit: 120 } }) // high-frequency polling (1.5s per call); relaxed rate limit
  @ApiOperation({ summary: '查询扫码状态（前端轮询，confirmed 时下发 Cookie）' })
  async getScanStatus(
    @Query('state') state: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!state) {
      throw new BadRequestException('state is required');
    }

    const statusResp = await this.wechatAuthService.getScanStatus(state);

    // Issue token one-time when confirmed
    if (statusResp.status === 'confirmed' && statusResp.user) {
      const tokenResult = await this.wechatAuthService.issueTokenForConfirmedScan(state);
      if (tokenResult) {
        this.setAuthCookies(res, tokenResult.accessToken, tokenResult.refreshToken);
        this.logger.log(
          `[QRLoginSuccess] userId=${tokenResult.user.id} username=${tokenResult.user.username} cookies set`,
        );
        return {
          ...statusResp,
          user: tokenResult.user,
        };
      }
      // state already consumed (duplicate poll), return expired to prompt re-scan
      return { ...statusResp, status: 'expired' as const };
    }

    return statusResp;
  }

  /**
   * 3. WeChat callback (real mode)
   *
   * WeChat redirects inside the iframe to this endpoint ?code=CODE&state=STATE
   * Only handles login (code->token->openid->create user->state=confirmed); does not issue Token or redirect.
   * Token issuance is done by the frontend polling /status (sets Cookie once confirmed).
   */
  @Get('callback')
  @ApiOperation({ summary: '微信扫码授权回调（真实模式）' })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      throw new BadRequestException('code and state are required');
    }
    // Handle WeChat callback (code -> access_token -> openid -> find/create user -> state=confirmed)
    await this.wechatAuthService.handleCallback(code, state);

    this.logger.log(
      `[WeChatCallbackDone] state=${state.slice(0, 16)}... marked confirmed, waiting for frontend polling to deliver tokens`,
    );

    // Return a simple page (shown inside the iframe, not actually visible to the user)
    // Token issuance is done by the /status poll, avoiding browser interception of HTTPS->HTTP redirect
    res.send(this.buildCallbackHtml('授权成功，正在登录...', true, ''));
  }

  /** Build the callback-result HTML page */
  private buildCallbackHtml(message: string, success: boolean, redirectUrl: string): string {
    const redirectJs = redirectUrl
      ? `<script>setTimeout(function(){ window.location.href = '${redirectUrl}'; }, 1500);</script>`
      : '';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Smart Site - 微信登录</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 40px 60px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
  .icon { font-size: 48px; margin-bottom: 16px; }
  .msg { font-size: 18px; color: #333; margin-bottom: 8px; }
  .hint { font-size: 13px; color: #999; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">${success ? '✓' : '✗'}</div>
  <div class="msg">${message}</div>
  <div class="hint">如未自动跳转，请手动访问系统</div>
</div>
${redirectJs}
</body>
</html>`;
  }

  /**
   * 4. Mock scan (only available in Mock mode)
   *
   * Simulate a user confirming/cancelling a phone scan, for dev/debug convenience
   */
  @Post('mock-scan')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Mock 扫码确认/取消（仅 WECHAT_MOCK=true 时可用）' })
  async mockScan(@Body() dto: WechatMockScanDto) {
    await this.wechatAuthService.handleMockScan(dto.state, dto.action);
    return { message: dto.action === 'confirm' ? '已模拟扫码确认' : '已模拟取消扫码' };
  }
}
