// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ExtractJwt } from 'passport-jwt';
import { UserRole } from '../../user/entities/user.entity';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// ⚠️  debug-mock-token only works in non-production:
//     frontend VITE_DEBUG_SKIP_AUTH (.env.development) -> injects debug-mock-token
//     backend isDevMode() -> recognizes only when NODE_ENV !== 'production'
//     if the production build accidentally enables VITE_DEBUG_SKIP_AUTH=true, the frontend skips login
//     but backend isDevMode()=false -> real JWT verification -> 401 Unauthorized -> no data fetched
//     see: ss-editor/apps/web/.env.full and package.json build-script comments
const DEBUG_TOKEN = 'debug-mock-token';

const MOCK_DEBUG_USER = {
  id: 'debug-user',
  username: 'debug',
  email: 'debug@local.dev',
  displayName: 'Debug User',
  role: UserRole.ADMIN,
  isActive: true,
};

function isDevMode(): boolean {
  return process.env.NODE_ENV !== 'production';
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Routes marked with @Public() skip JWT auth
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    if (!isDevMode()) {
      return super.canActivate(context) as Promise<boolean>;
    }

    const request = context.switchToHttp().getRequest();
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);

    if (token === DEBUG_TOKEN) {
      request.user = MOCK_DEBUG_USER;
      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }

  /**
   * Override handleRequest: convert passport exceptions such as TokenExpiredError into 401
   * so the frontend 401 interceptor can correctly trigger automatic token refresh
   */
  handleRequest<TUser = any>(
    err: any,
    user: any,
    _info: any,
    _context: ExecutionContext,
    _status?: any,
  ): TUser {
    if (err || !user) {
      if (err) {
        // TokenExpiredError / JsonWebTokenError / NotBeforeError, etc.
        throw new UnauthorizedException(err.message || 'Token 验证失败');
      }
      throw new UnauthorizedException('未登录或登录已过期');
    }
    return user;
  }
}
