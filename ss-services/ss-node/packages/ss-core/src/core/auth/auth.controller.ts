// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * Get the login feature switch (public endpoint, called before login)
   *
   * The frontend LoginView queries this endpoint during initialization and decides whether to show the
   * WeChat QR-code tab based on wechatLoginEnabled. When off, the backend does not register WechatAuthModule
   * (conditional registration in app.module.ts) and the frontend does not show the entry either.
   */
  @Get('features')
  @Public()
  @ApiOperation({ summary: '获取登录功能开关（公开，登录前调用）' })
  getLoginFeatures() {
    return {
      wechatLoginEnabled: process.env.WECHAT_LOGIN_ENABLED === 'true',
      // Reserved for SMS verification-code login in §2.7 (currently fixed false; read SMS_LOGIN_ENABLED once SMS login is implemented)
      smsLoginEnabled: process.env.SMS_LOGIN_ENABLED === 'true',
    };
  }

  /**
   * Extract the client IP from the request (supports proxy-forwarding scenarios)
   */
  private getClientIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      req.socket?.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Check the presence of Cookie and Authorization Header in the request (for log diagnosis, without leaking values)
   */
  private describeAuthSources(req: Request): string {
    const parts: string[] = [];
    if (req.cookies?.accessToken) parts.push('cookie[accessToken]=yes');
    else parts.push('cookie[accessToken]=no');
    if (req.cookies?.refreshToken) parts.push('cookie[refreshToken]=yes');
    else parts.push('cookie[refreshToken]=no');
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) parts.push('header[Bearer]=yes');
    else parts.push('header[Bearer]=no');
    return parts.join(' | ');
  }

  /**
   * S-C03: set HttpOnly + Secure + SameSite=Strict auth Cookies
   *
   * accessToken Cookie: path=/, available to all API endpoints
   * refreshToken Cookie: path=/api/v1/auth, available only to auth endpoints (smaller attack surface)
   *
   * Secure flag strategy (CODE-10 fix):
   *   - Production defaults to secure=true (requires HTTPS deployment)
   *   - HTTP deployment (e.g. http://ip) must explicitly disable it via env var COOKIE_SECURE=false,
   *     otherwise the browser drops the Secure Cookie, preventing the login session from persisting
   *     (symptom: immediate 401 after login, repeated retries time out)
   *   - Dev environment defaults to secure=false
   */
  private setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    // Explicit COOKIE_SECURE config takes priority; when unset, production defaults to true (HTTPS), dev defaults to false
    const cookieSecure =
      process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === 'true' : isProduction;
    const cookieBase = {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'strict' as const,
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

    this.logger.debug(
      `[Cookie] Auth cookies set | accessToken: httpOnly=true secure=${cookieSecure} sameSite=strict maxAge=15min path=/ | refreshToken: httpOnly=true secure=${cookieSecure} sameSite=strict maxAge=7d path=/api/v1/auth`,
    );
  }

  /**
   * S-C03: clear auth Cookies
   * clearCookie must match the path used when setting to clear correctly; the secure flag does not affect clearing.
   */
  private clearAuthCookies(res: Response): void {
    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  }

  /**
   * Desktop (Tauri) detection: page origin is tauri.localhost, cross-site with the backend,
   * so SameSite=Strict HttpOnly Cookies cannot be sent with cross-site XHR;
   * therefore switch to Bearer Token mode: token delivered via response body, frontend stores in memory and sends via Authorization header.
   * Web (same-origin) is unaffected and still uses Cookie mode.
   */
  private isTauriClient(req: Request): boolean {
    const origin = req.headers.origin || '';
    return origin.includes('tauri.localhost') || origin.startsWith('tauri://');
  }

  /**
   * Mini-program client detection: WeChat mini-program requests have no Origin header and UA contains miniProgram,
   * has no Cookie capability, and also switches to Bearer mode: token delivered via response body.
   * Only judged when there is no Origin (to avoid mis-hitting Web; Web same-origin requests carry Origin and have Cookies).
   */
  private isWechatMpClient(req: Request): boolean {
    const origin = req.headers.origin || '';
    const userAgent = req.headers['user-agent'] || '';
    return !origin && /miniProgram/i.test(userAgent);
  }

  /** Non-browser clients (desktop / mini-program): cookies unavailable, tokens delivered via response body */
  private isBearerTokenClient(req: Request): boolean {
    return this.isTauriClient(req) || this.isWechatMpClient(req);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: '用户登录（S-C03: Token 通过 HttpOnly Cookie 下发）' })
  @ApiBody({ type: LoginDto })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = this.getClientIp(req);
    this.logger.log(
      `[POST /auth/login] Login request | username="${loginDto.username}" ip=${clientIp} userAgent="${req.headers['user-agent']?.slice(0, 50) || 'unknown'}"`,
    );

    const result = await this.authService.login(loginDto, {
      ip: clientIp,
      userAgent: req.headers['user-agent'],
    });

    // Non-browser clients (desktop Tauri / mini-program): cookies unavailable, switched to response-body token delivery (Bearer mode)
    if (this.isBearerTokenClient(req)) {
      this.logger.log(
        `[POST /auth/login] Login response (desktop/mini-program Bearer mode) | userId="${result.user.id}" username="${result.user.username}" role="${result.user.role}"`,
      );
      return {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      };
    }

    // S-C03: token written into HttpOnly Cookie; response body returns only user info
    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    this.logger.log(
      `[POST /auth/login] Login response | userId="${result.user.id}" username="${result.user.username}" role="${result.user.role}" | cookies set | body contains user info only`,
    );
    return { user: result.user };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '用户注册（S-C03: Token 通过 HttpOnly Cookie 下发）' })
  @ApiBody({ type: RegisterDto })
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(registerDto);
    // Non-browser clients (desktop Tauri / mini-program): cookies unavailable, switched to response-body token delivery (Bearer mode)
    if (this.isBearerTokenClient(req)) {
      return {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      };
    }
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌（S-C03: 从 HttpOnly Cookie 读取 refreshToken）' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body?: RefreshTokenDto,
  ) {
    const clientIp = this.getClientIp(req);
    const authSources = this.describeAuthSources(req);
    this.logger.log(`[POST /auth/refresh] Refresh request | ip=${clientIp} | ${authSources}`);

    // S-C03: prefer reading refreshToken from Cookie, also accept body param (Swagger debugging / Bearer clients)
    const refreshTokenFromBody = body?.refreshToken;
    const refreshToken = req.cookies?.refreshToken || refreshTokenFromBody;
    if (!refreshToken) {
      this.logger.warn(
        `[POST /auth/refresh] No refreshToken | source: cookie=${!!req.cookies?.refreshToken} body=${!!refreshTokenFromBody} | ip=${clientIp}`,
      );
      return { message: '无 refresh token' };
    }

    // Mark the refreshToken source (Cookie or Body) for troubleshooting cookie transmission issues
    const tokenSource = req.cookies?.refreshToken ? 'cookie' : 'body';
    this.logger.debug(`[POST /auth/refresh] refreshToken source=${tokenSource} | ip=${clientIp}`);

    const result = await this.authService.refreshToken(refreshToken, {
      ip: clientIp,
      userAgent: req.headers['user-agent'],
    });

    // Non-browser clients (desktop / mini-program / H5): new token pairs delivered via response body (persisted by frontend for session recovery)
    // H5 browser requests carry Origin, so isTauriClient / isWechatMpClient do not match; but H5 has no cookie session
    // (token delivered via response body by login-password etc.); on refresh it must submit refreshToken via body,
    // so providing refreshToken in body is treated as Bearer mode, avoiding frontend session-recovery failure due to missing token in response.
    if (this.isBearerTokenClient(req) || !!refreshTokenFromBody) {
      this.logger.log(
        `[POST /auth/refresh] Refresh succeeded (Bearer mode: desktop/mini-program/H5) | ip=${clientIp}`,
      );
      return {
        message: '令牌已刷新',
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      };
    }

    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    this.logger.log(`[POST /auth/refresh] Refresh succeeded | cookies updated | ip=${clientIp}`);
    return { message: '令牌已刷新' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '退出登录（S-C03: 清除 HttpOnly Cookie）' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body?: RefreshTokenDto,
  ) {
    const clientIp = this.getClientIp(req);
    this.logger.log(
      `[POST /auth/logout] Logout request | ip=${clientIp} | ${this.describeAuthSources(req)}`,
    );

    const refreshToken = req.cookies?.refreshToken || body?.refreshToken;
    if (refreshToken) {
      await this.authService.logout(refreshToken, {
        ip: clientIp,
        userAgent: req.headers['user-agent'],
      });
    } else {
      this.logger.debug(`[POST /auth/logout] No refreshToken, clearing cookies only | ip=${clientIp}`);
    }
    this.clearAuthCookies(res);

    this.logger.log(`[POST /auth/logout] Logout complete | cookies cleared | ip=${clientIp}`);
    return { message: '已退出登录' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '修改密码（S-C03: 成功后刷新 Cookie）' })
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(
    @Req() req: any,
    @Body() changePasswordDto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = this.getClientIp(req);
    const result = await this.authService.changePassword(req.user.id, changePasswordDto, {
      ip: clientIp,
      userAgent: req.headers['user-agent'],
    });
    // After password change the old token is revoked; regenerate and deliver
    // changePassword already revoked the old refresh token internally; regenerate here
    const { password: _pw, ...userWithoutPw } = req.user;
    const tokens = await this.authService.generateTokensForUser(userWithoutPw);
    // Non-browser clients (desktop / mini-program): new token pairs delivered via response body, otherwise keep Cookie mode
    if (this.isBearerTokenClient(req)) {
      return { ...result, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return result;
  }
}
