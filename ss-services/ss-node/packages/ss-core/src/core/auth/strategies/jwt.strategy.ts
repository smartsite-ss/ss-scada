// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, UnauthorizedException, Logger, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { UserService } from '../../user/user.service';
import { I18nService } from '@ss-node/ss-i18n';

/**
 * S-C03: JWT extractor
 *
 * Prefer reading accessToken from the HttpOnly Cookie (main path, XSS-safe);
 * if the Cookie is absent, fall back to the Authorization: Bearer Header (compatible with Swagger debugging and API clients).
 *
 * Logging: mark the token source (cookie / bearer / none) on the request for use by validate().
 */
function extractJwtFromRequest(req: Request): string | null {
  // 1. Prefer extraction from HttpOnly Cookie
  if (req.cookies?.accessToken) {
    (req as any)._jwtSource = 'cookie';
    return req.cookies.accessToken as string;
  }

  // 2. Fall back to Authorization Bearer Header (Swagger / API clients)
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    (req as any)._jwtSource = 'bearer';
    return authHeader.slice(7);
  }

  (req as any)._jwtSource = 'none';
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private userService: UserService,
    @Inject(I18nService)
    private i18nService: I18nService,
  ) {
    super({
      jwtFromRequest: extractJwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    });
  }

  async validate(payload: any) {
    // payload is obtained by JWT decoding; the signature has already been verified at this point
    // payload.exp may be undefined (test payload or token without expiration); handle defensively
    const expStr = payload.exp
      ? new Date(payload.exp * 1000).toISOString()
      : 'N/A';
    this.logger.debug(
      `[JWTVerify] Token valid | userId="${payload.sub}" username="${payload.username}" role="${payload.role}" | exp=${expStr}`,
    );

    const user = await this.userService.findById(payload.sub);
    if (!user) {
      this.logger.warn(
        `[JWTVerify] User not found | userId="${payload.sub}" username="${payload.username}"`,
      );
      throw new UnauthorizedException(this.i18nService.tSync('auth.login.failed_not_found'));
    }

    return user;
  }
}
