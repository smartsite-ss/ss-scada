// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { I18nService } from '@ss-node/ss-i18n';
import { validatePasswordStrength } from './utils/password-validation.util';
import { AuditLoggerService } from '../../logger/audit-logger.service';
import type { AuditContext } from './audit-context.types';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface LoginAttempt {
  count: number;
  lastAttempt: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private refreshTokenStore: Map<string, { userId: string; username: string; role: string }> =
    new Map();
  private revokedTokens: Set<string> = new Set(); // tokens explicitly revoked; prevents reuse via the JWT fallback path after a service restart
  private loginAttempts: Map<string, LoginAttempt> = new Map();
  private readonly ACCESS_TOKEN_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
  private readonly REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    @Inject(I18nService)
    private i18nService: I18nService,
    private auditLogger: AuditLoggerService,
  ) {}

  /**
   * Generate a token mask (keep only the first 8 chars + ...), used to safely identify a token in logs without leaking the full value
   */
  private maskToken(token: string): string {
    if (!token || token.length < 12) return '***';
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  }

  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.userService.findByUsername(username);
    if (user && (await bcrypt.compare(password, user.password))) {
      const { password: _password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto, auditCtx?: AuditContext) {
    const startTime = Date.now();
    this.logger.log(
      `[登录] 收到登录请求 | username="${loginDto.username}"`,
    );

    const user = await this.userService.findByUsername(loginDto.username);
    if (!user) {
      this.logger.warn(
        `[登录] 用户不存在 | username="${loginDto.username}" | 耗时=${Date.now() - startTime}ms`,
      );
      this.auditLogger.logSecurityEvent({
        type: 'auth.login.failed',
        severity: 'warning',
        username: loginDto.username,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        details: { reason: 'user_not_found', durationMs: Date.now() - startTime },
      });
      throw new UnauthorizedException(
        this.i18nService.tSync('auth.login.failed_invalid_credentials'),
      );
    }

    this.logger.debug(
      `[登录] 用户查询成功 | userId="${user.id}" username="${user.username}" role="${user.role}" | 耗时=${Date.now() - startTime}ms`,
    );

    // Check whether the account is locked
    this.checkLoginLockout(user.id);

    const isValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isValid) {
      const attempt = this.loginAttempts.get(user.id);
      this.logger.warn(
        `[登录] 密码验证失败 | userId="${user.id}" username="${user.username}" | 失败次数=${attempt?.count || 1}/${this.MAX_LOGIN_ATTEMPTS} | 耗时=${Date.now() - startTime}ms`,
      );
      this.recordFailedLoginAttempt(user.id);
      this.auditLogger.logSecurityEvent({
        type: 'auth.login.failed',
        severity: 'warning',
        userId: user.id,
        username: user.username,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        details: {
          reason: 'invalid_password',
          attemptCount: attempt?.count || 1,
          maxAttempts: this.MAX_LOGIN_ATTEMPTS,
          durationMs: Date.now() - startTime,
        },
      });
      throw new UnauthorizedException(
        this.i18nService.tSync('auth.login.failed_invalid_credentials'),
      );
    }

    // Login succeeded, reset failure count
    this.resetLoginAttempts(user.id);

    const { password: _password, ...result } = user;
    const tokens = this.generateTokens(result);

    this.logger.log(
      `[登录] 登录成功 | userId="${user.id}" username="${user.username}" role="${user.role}" | accessToken=${this.maskToken(tokens.accessToken)} refreshToken=${this.maskToken(tokens.refreshToken)} | 总耗时=${Date.now() - startTime}ms`,
    );
    this.auditLogger.logSecurityEvent({
      type: 'auth.login.success',
      severity: 'info',
      userId: user.id,
      username: user.username,
      ip: auditCtx?.ip,
      userAgent: auditCtx?.userAgent,
      details: { role: user.role, durationMs: Date.now() - startTime },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: result.id,
        username: result.username,
        email: result.email,
        displayName: result.displayName,
        role: result.role,
      },
    };
  }

  async register(registerDto: RegisterDto) {
    const user = await this.userService.createUser(registerDto);
    const { password: _password, ...result } = user;
    const tokens = this.generateTokens(result);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: result,
    };
  }

  async refreshToken(token: string, auditCtx?: AuditContext) {
    const startTime = Date.now();
    const maskedToken = this.maskToken(token);
    this.logger.log(`[刷新Token] 收到刷新请求 | refreshToken=${maskedToken}`);

    // First check whether it has been explicitly revoked (logout / changePassword)
    if (this.revokedTokens.has(token)) {
      this.logger.warn(
        `[刷新Token] Token 已被撤销（logout/changePassword） | token=${maskedToken} | 耗时=${Date.now() - startTime}ms`,
      );
      this.auditLogger.logSecurityEvent({
        type: 'auth.refresh.failed',
        severity: 'critical',
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        details: {
          reason: 'revoked_token_reuse',
          token: maskedToken,
          durationMs: Date.now() - startTime,
        },
      });
      throw new UnauthorizedException(
        this.i18nService.tSync('auth.login.failed_invalid_credentials'),
      );
    }

    // Path 1: Map hit (normal flow, service not restarted)
    const cached = this.refreshTokenStore.get(token);
    if (cached) {
      this.logger.debug(
        `[刷新Token] Map 命中（正常路径） | userId="${cached.userId}" username="${cached.username}" | token=${maskedToken}`,
      );
      this.refreshTokenStore.delete(token); // one-time use
      const tokens = this.generateTokens(cached);
      this.logger.log(
        `[刷新Token] 刷新成功（Map路径） | userId="${cached.userId}" username="${cached.username}" | newAccessToken=${this.maskToken(tokens.accessToken)} newRefreshToken=${this.maskToken(tokens.refreshToken)} | 耗时=${Date.now() - startTime}ms`,
      );
      this.auditLogger.logSecurityEvent({
        type: 'auth.refresh.success',
        severity: 'info',
        userId: cached.userId,
        username: cached.username,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        details: { path: 'map', durationMs: Date.now() - startTime },
      });
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    // Path 2: Map miss (service restart cleared the in-memory Map) -> fall back to JWT signature verification
    this.logger.debug(
      `[刷新Token] Map 未命中，降级为 JWT 签名验证 | token=${maskedToken}`,
    );
    try {
      const jwtPayload = this.jwtService.verify<{ sub: string }>(token);
      if (!jwtPayload || !jwtPayload.sub) {
        this.logger.warn(
          `[刷新Token] JWT payload 无效（缺少 sub） | token=${maskedToken} | 耗时=${Date.now() - startTime}ms`,
        );
        throw new Error('Invalid refresh token payload');
      }

      const user = await this.userService.findById(jwtPayload.sub);
      if (!user) {
        this.logger.warn(
          `[刷新Token] 用户不存在 | userId="${jwtPayload.sub}" | token=${maskedToken} | 耗时=${Date.now() - startTime}ms`,
        );
        throw new UnauthorizedException(this.i18nService.tSync('auth.login.failed_not_found'));
      }

      const tokens = this.generateTokens({
        id: user.id,
        username: user.username,
        role: user.role,
      });
      this.logger.log(
        `[刷新Token] 刷新成功（JWT降级路径） | userId="${user.id}" username="${user.username}" | newAccessToken=${this.maskToken(tokens.accessToken)} newRefreshToken=${this.maskToken(tokens.refreshToken)} | 耗时=${Date.now() - startTime}ms`,
      );
      this.auditLogger.logSecurityEvent({
        type: 'auth.refresh.success',
        severity: 'info',
        userId: user.id,
        username: user.username,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        details: { path: 'jwt_fallback', durationMs: Date.now() - startTime },
      });
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    } catch (err) {
      // Distinguish already-thrown HttpException from JWT verification failure
      if (err instanceof UnauthorizedException) throw err;
      this.logger.warn(
        `[刷新Token] JWT 验证失败 | token=${maskedToken} error="${(err as Error).message}" | 耗时=${Date.now() - startTime}ms`,
      );
      this.auditLogger.logSecurityEvent({
        type: 'auth.refresh.failed',
        severity: 'warning',
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        details: {
          reason: 'jwt_verification_failed',
          error: (err as Error).message,
          token: maskedToken,
          durationMs: Date.now() - startTime,
        },
      });
      throw new UnauthorizedException(
        this.i18nService.tSync('auth.login.failed_invalid_credentials'),
      );
    }
  }

  async logout(token: string, auditCtx?: AuditContext): Promise<void> {
    const maskedToken = this.maskToken(token);
    this.logger.log(`[登出] 收到登出请求 | refreshToken=${maskedToken}`);

    const cached = this.refreshTokenStore.get(token);
    this.refreshTokenStore.delete(token);
    this.revokedTokens.add(token); // mark revoked, preventing reuse via the JWT fallback path

    this.logger.log(
      `[登出] Token 已撤销 | userId="${cached?.userId || 'unknown'}" username="${cached?.username || 'unknown'}" | token=${maskedToken} | revokedTotal=${this.revokedTokens.size}`,
    );
    this.auditLogger.logSecurityEvent({
      type: 'auth.logout',
      severity: 'info',
      userId: cached?.userId,
      username: cached?.username,
      ip: auditCtx?.ip,
      userAgent: auditCtx?.userAgent,
      details: { revokedTotal: this.revokedTokens.size },
    });
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto, auditCtx?: AuditContext) {
    const { oldPassword, newPassword, confirmPassword } = changePasswordDto;
    this.logger.log(`[修改密码] 收到修改密码请求 | userId="${userId}"`);

    // Verify the two passwords match
    if (newPassword !== confirmPassword) {
      this.logger.warn(`[修改密码] 两次密码不一致 | userId="${userId}"`);
      this.auditLogger.logSecurityEvent({
        type: 'auth.password.failed',
        severity: 'warning',
        userId,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        details: { reason: 'password_mismatch' },
      });
      throw new BadRequestException('两次输入的新密码不一致');
    }

    // Verify password strength
    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      this.logger.warn(`[修改密码] 密码强度不足 | userId="${userId}" reason="${strengthCheck.message}"`);
      this.auditLogger.logSecurityEvent({
        type: 'auth.password.failed',
        severity: 'warning',
        userId,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        details: { reason: 'weak_password', detail: strengthCheck.message },
      });
      throw new BadRequestException(strengthCheck.message);
    }

    // Verify old password and update password
    await this.userService.changePassword(userId, oldPassword, newPassword);

    // Revoke all refresh tokens of this user
    this.revokeAllUserTokens(userId);

    this.logger.log(
      `[修改密码] 密码修改成功，已撤销所有旧 Token | userId="${userId}" | revokedTotal=${this.revokedTokens.size}`,
    );
    this.auditLogger.logSecurityEvent({
      type: 'auth.password.changed',
      severity: 'info',
      userId,
      ip: auditCtx?.ip,
      userAgent: auditCtx?.userAgent,
      details: { revokedTokenCount: this.revokedTokens.size },
    });
    return { message: '密码修改成功' };
  }

  /**
   * S-C03: generate a new token pair for the specified user (used to re-set Cookies after changePassword)
   */
  async generateTokensForUser(user: {
    id?: string;
    username: string;
    role: string;
  }): Promise<TokenPair> {
    return this.generateTokens({
      id: user.id,
      username: user.username,
      role: user.role,
    });
  }

  /**
   * Revoke all refresh tokens of the specified user
   */
  private revokeAllUserTokens(userId: string): void {
    for (const [token, payload] of this.refreshTokenStore.entries()) {
      if (payload.userId === userId) {
        this.refreshTokenStore.delete(token);
        this.revokedTokens.add(token); // mark revoked as well
      }
    }
  }

  /**
   * Check login lock status
   */
  private checkLoginLockout(userId: string): void {
    const attempt = this.loginAttempts.get(userId);
    if (!attempt) return;

    if (attempt.count >= this.MAX_LOGIN_ATTEMPTS) {
      const elapsed = Date.now() - attempt.lastAttempt;
      if (elapsed < this.LOCKOUT_DURATION_MS) {
        const remainingMinutes = Math.ceil((this.LOCKOUT_DURATION_MS - elapsed) / 60000);
        throw new UnauthorizedException(`账户已被锁定，请 ${remainingMinutes} 分钟后重试`);
      }
      // Lock time elapsed, reset
      this.loginAttempts.delete(userId);
    }
  }

  /**
   * Record a failed login attempt
   */
  private recordFailedLoginAttempt(userId: string): void {
    const existing = this.loginAttempts.get(userId);
    if (existing) {
      // If lock time elapsed, reset the count
      if (
        existing.count >= this.MAX_LOGIN_ATTEMPTS &&
        Date.now() - existing.lastAttempt >= this.LOCKOUT_DURATION_MS
      ) {
        this.loginAttempts.set(userId, { count: 1, lastAttempt: Date.now() });
        return;
      }
      existing.count += 1;
      existing.lastAttempt = Date.now();
    } else {
      this.loginAttempts.set(userId, { count: 1, lastAttempt: Date.now() });
    }
  }

  /**
   * Reset login failure count
   */
  private resetLoginAttempts(userId: string): void {
    this.loginAttempts.delete(userId);
  }

  private generateTokens(payload: {
    id?: string;
    sub?: string;
    userId?: string;
    username: string;
    role: string;
  }): TokenPair {
    const userId = payload.id || payload.sub || payload.userId || '';
    const tokenPayload = { username: payload.username, sub: userId, role: payload.role };

    const accessToken = this.jwtService.sign(tokenPayload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRES,
    });

    const refreshTokenPayload = { sub: userId, type: 'refresh' };
    const refreshToken = this.jwtService.sign(refreshTokenPayload, {
      expiresIn: this.REFRESH_TOKEN_EXPIRES,
    });

    this.refreshTokenStore.set(refreshToken, {
      userId: userId,
      username: payload.username,
      role: payload.role,
    });

    this.logger.debug(
      `[生成Token] userId="${userId}" username="${payload.username}" role="${payload.role}" | accessToken=${this.maskToken(accessToken)} expiresIn=${this.ACCESS_TOKEN_EXPIRES} | refreshToken=${this.maskToken(refreshToken)} expiresIn=${this.REFRESH_TOKEN_EXPIRES} | storeSize=${this.refreshTokenStore.size}`,
    );

    return { accessToken, refreshToken };
  }
}
