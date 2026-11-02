// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { UserService } from '../../user/user.service';
import { AuthService } from '../auth.service';
import { WechatApiService } from './wechat-api.service';
import { User } from '../../user/entities/user.entity';
import { ProjectAuthorization } from '../../user/entities/project-authorization.entity';
import { PathResolverService } from '../../../path/path-resolver.service';
import { AuditLoggerService } from '../../../logger/audit-logger.service';
import type { AuditContext } from '../audit-context.types';
import {
  WechatMpLoginResponse,
  WechatMpBindResponse,
  WechatMpLoginUserInfo,
  WechatMpAuthorizedProject,
  WechatMpTokenPair,
} from './wechat-auth.types';

/** Project permission-level weight (take the highest among multiple grants in the same project) */
const PERMISSION_RANK: Record<WechatMpAuthorizedProject['permissionLevel'], number> = {
  read: 1,
  write: 2,
  admin: 3,
};

/**
 * WeChat mini-program authorized-login service
 *
 * Flow (differs from the open-platform web scan login):
 *   1. login: wx.login code -> code2session to exchange openid -> check binding relation
 *      - Bound: verify active -> issue dual token + user info + authorized-projects snapshot
 *      - Unbound: return bindingRequired=true, frontend guides to account-password binding
 *   2. bind: re-run code2session (code is one-time) -> verify system account/password -> write binding -> issue
 *   3. unbind: clear binding relation (operation by a logged-in user, via JWT auth)
 *
 * session_key is held by the backend only temporarily (within this request); not persisted, not issued.
 */
@Injectable()
export class WechatMpAuthService {
  private readonly logger = new Logger(WechatMpAuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly wechatApiService: WechatApiService,
    private readonly auditLogger: AuditLoggerService,
    private readonly pathResolver: PathResolverService,
    @InjectRepository(ProjectAuthorization)
    private readonly projectAuthorizationRepository: Repository<ProjectAuthorization>,
  ) {}

  /**
   * Mini-program WeChat login
   *
   * @returns bound: tokenPair + userInformation + authorizedProjects
   *          unbound: bindingRequired=true (tokenPair/userInformation are null)
   */
  async login(loginCode: string, auditContext?: AuditContext): Promise<WechatMpLoginResponse> {
    const session = await this.wechatApiService.getCode2Session(loginCode);
    const openidMasked = `${session.openid.slice(0, 6)}...`;

    const boundUser = await this.userService.findByWechatMpOpenId(session.openid);
    if (!boundUser) {
      this.logger.log(`[小程序登录] openid 未绑定系统账号，需引导账密绑定 | openid=${openidMasked}`);
      this.auditLogger.logSecurityEvent({
        type: 'auth.wechat_mp.login.binding_required',
        severity: 'info',
        ip: auditContext?.ip,
        userAgent: auditContext?.userAgent,
        details: { openidMasked },
      });
      return {
        tokenPair: null,
        userInformation: null,
        bindingRequired: true,
        authorizedProjects: [],
      };
    }

    if (!boundUser.isActive) {
      this.logger.warn(`[小程序登录] 账号已禁用，拒绝登录 | userId="${boundUser.id}" username="${boundUser.username}"`);
      this.auditLogger.logSecurityEvent({
        type: 'auth.wechat_mp.login.failed',
        severity: 'warning',
        userId: boundUser.id,
        username: boundUser.username,
        ip: auditContext?.ip,
        userAgent: auditContext?.userAgent,
        details: { reason: 'account_disabled' },
      });
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }

    // Reload the user with role relation (roleNames needed for display)
    const userWithRole = await this.userService.findById(boundUser.id);
    const tokenPair = await this.authService.generateTokensForUser({
      id: userWithRole.id,
      username: userWithRole.username,
      role: userWithRole.role,
    });
    const authorizedProjects = await this.listAuthorizedProjects(userWithRole);

    this.logger.log(
      `[小程序登录] 登录成功 | userId="${userWithRole.id}" username="${userWithRole.username}" | authorizedProjectCount=${authorizedProjects.length}`,
    );
    this.auditLogger.logSecurityEvent({
      type: 'auth.wechat_mp.login.success',
      severity: 'info',
      userId: userWithRole.id,
      username: userWithRole.username,
      ip: auditContext?.ip,
      userAgent: auditContext?.userAgent,
      details: { authorizedProjectCount: authorizedProjects.length },
    });

    return {
      tokenPair,
      userInformation: this.buildLoginUserInfo(userWithRole),
      bindingRequired: false,
      authorizedProjects,
    };
  }

  /**
   * Account-password binding (submitted from the first WeChat-login guide page)
   *
   * Note: loginCode must be freshly fetched by the frontend at submit time (code is one-time + 5-min validity).
   * Conflict scenario: this openid already bound to another account, or target account already bound to another openid -> ACCOUNT_ALREADY_BOUND
   */
  async bind(
    loginCode: string,
    username: string,
    password: string,
    auditContext?: AuditContext,
  ): Promise<WechatMpBindResponse> {
    const session = await this.wechatApiService.getCode2Session(loginCode);
    const openidMasked = `${session.openid.slice(0, 6)}...`;

    const existingBoundUser = await this.userService.findByWechatMpOpenId(session.openid);
    if (existingBoundUser) {
      this.logger.warn(
        `[小程序绑定] 该微信已绑定其他账号，拒绝重复绑定 | openid=${openidMasked} boundUserId="${existingBoundUser.id}"`,
      );
      this.auditLogger.logSecurityEvent({
        type: 'auth.wechat_mp.bind.failed',
        severity: 'warning',
        username,
        ip: auditContext?.ip,
        userAgent: auditContext?.userAgent,
        details: { reason: 'openid_already_bound', openidMasked },
      });
      throw new ConflictException({
        code: 'ACCOUNT_ALREADY_BOUND',
        message: '该微信已绑定其他系统账号，请先在原账号解绑',
      });
    }

    const account = await this.userService.findByUsername(username);
    const passwordValid = account ? await bcrypt.compare(password, account.password) : false;
    if (!account || !passwordValid) {
      this.logger.warn(`[小程序绑定] 账号或密码错误 | username="${username}"`);
      this.auditLogger.logSecurityEvent({
        type: 'auth.wechat_mp.bind.failed',
        severity: 'warning',
        username,
        ip: auditContext?.ip,
        userAgent: auditContext?.userAgent,
        details: { reason: 'invalid_credentials', openidMasked },
      });
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (!account.isActive) {
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }
    if (account.wechatMpOpenId && account.wechatMpOpenId !== session.openid) {
      this.logger.warn(`[小程序绑定] 目标账号已绑定其他微信，拒绝换绑 | userId="${account.id}"`);
      this.auditLogger.logSecurityEvent({
        type: 'auth.wechat_mp.bind.failed',
        severity: 'warning',
        userId: account.id,
        username,
        ip: auditContext?.ip,
        userAgent: auditContext?.userAgent,
        details: { reason: 'account_already_bound_other_openid' },
      });
      throw new ConflictException({
        code: 'ACCOUNT_ALREADY_BOUND',
        message: '该系统账号已绑定其他微信，请先在原微信解绑',
      });
    }

    await this.userService.bindWechatMpOpenId(account.id, session.openid);

    const userWithRole = await this.userService.findById(account.id);
    const tokenPair = await this.authService.generateTokensForUser({
      id: userWithRole.id,
      username: userWithRole.username,
      role: userWithRole.role,
    });
    const authorizedProjects = await this.listAuthorizedProjects(userWithRole);

    this.logger.log(
      `[小程序绑定] 绑定成功并已登录 | userId="${userWithRole.id}" username="${userWithRole.username}" | openid=${openidMasked}`,
    );
    this.auditLogger.logSecurityEvent({
      type: 'auth.wechat_mp.bind.success',
      severity: 'info',
      userId: userWithRole.id,
      username: userWithRole.username,
      ip: auditContext?.ip,
      userAgent: auditContext?.userAgent,
      details: { openidMasked },
    });

    return {
      tokenPair,
      userInformation: this.buildLoginUserInfo(userWithRole),
      authorizedProjects,
    };
  }

  /**
   * Account-password login (does not depend on WeChat code, uses system account/password directly)
   *
   * Difference from WeChat login: does not involve code2session / openid binding, only verifies system account/password then issues dual token.
   * Response structure is consistent with bind (tokenPair + userInformation + authorizedProjects); the frontend applySession handles uniformly.
   */
  async loginWithPassword(
    username: string,
    password: string,
    auditContext?: AuditContext,
  ): Promise<WechatMpBindResponse> {
    const account = await this.userService.findByUsername(username);
    const passwordValid = account ? await bcrypt.compare(password, account.password) : false;
    if (!account || !passwordValid) {
      this.logger.warn(`[小程序账密登录] 账号或密码错误 | username="${username}"`);
      this.auditLogger.logSecurityEvent({
        type: 'auth.wechat_mp.password_login.failed',
        severity: 'warning',
        username,
        ip: auditContext?.ip,
        userAgent: auditContext?.userAgent,
        details: { reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (!account.isActive) {
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }

    const userWithRole = await this.userService.findById(account.id);
    const tokenPair = await this.authService.generateTokensForUser({
      id: userWithRole.id,
      username: userWithRole.username,
      role: userWithRole.role,
    });
    const authorizedProjects = await this.listAuthorizedProjects(userWithRole);

    this.logger.log(
      `[小程序账密登录] 登录成功 | userId="${userWithRole.id}" username="${userWithRole.username}" | authorizedProjectCount=${authorizedProjects.length}`,
    );
    this.auditLogger.logSecurityEvent({
      type: 'auth.wechat_mp.password_login.success',
      severity: 'info',
      userId: userWithRole.id,
      username: userWithRole.username,
      ip: auditContext?.ip,
      userAgent: auditContext?.userAgent,
      details: { authorizedProjectCount: authorizedProjects.length },
    });

    return {
      tokenPair,
      userInformation: this.buildLoginUserInfo(userWithRole),
      authorizedProjects,
    };
  }

  /** Unbind the current logged-in user's mini-program WeChat (via JWT auth, userId injected by Controller) */
  async unbind(userId: string, auditContext?: AuditContext): Promise<{ message: string }> {
    await this.userService.unbindWechatMpOpenId(userId);
    this.logger.log(`[小程序解绑] 解绑成功 | userId="${userId}"`);
    this.auditLogger.logSecurityEvent({
      type: 'auth.wechat_mp.unbind',
      severity: 'info',
      userId,
      ip: auditContext?.ip,
      userAgent: auditContext?.userAgent,
    });
    return { message: '微信绑定已解除' };
  }

  /** Build login user info (aligned with frontend LoginUserInfo) */
  private buildLoginUserInfo(user: User): WechatMpLoginUserInfo {
    return {
      userId: user.id,
      username: user.username,
      nickname: user.displayName || user.username,
      avatarUrl: user.avatar || null,
      roleNames: [user.roleEntity?.name || user.role],
    };
  }

  /**
   * Query the authorized-projects snapshot for the user's roles
   *
   * Take the highest permission level among multiple grants in the same project (admin > write > read);
   * projectName is read from {PROJECTS_DIR}/{projectId}/projectinfo.json, falling back to projectId when missing.
   */
  private async listAuthorizedProjects(user: User): Promise<WechatMpAuthorizedProject[]> {
    if (!user.roleId) return [];

    const authorizations = await this.projectAuthorizationRepository.find({
      where: { roleId: user.roleId },
    });

    const mergedByProjectId = new Map<string, WechatMpAuthorizedProject>();
    for (const authorization of authorizations) {
      const permissionLevel = this.normalizePermissionLevel(authorization.permission);
      const existing = mergedByProjectId.get(authorization.projectId);
      if (!existing || PERMISSION_RANK[permissionLevel] > PERMISSION_RANK[existing.permissionLevel]) {
        mergedByProjectId.set(authorization.projectId, {
          projectId: authorization.projectId,
          projectName: this.readProjectName(authorization.projectId),
          permissionLevel,
        });
      }
    }
    return Array.from(mergedByProjectId.values());
  }

  /** Normalize permission level (illegal value downgraded to read) */
  private normalizePermissionLevel(permission: string): WechatMpAuthorizedProject['permissionLevel'] {
    if (permission === 'admin' || permission === 'write' || permission === 'read') {
      return permission;
    }
    return 'read';
  }

  /** Read the project display name from projectinfo.json (compatible with the old name field); fall back to projectId on failure */
  private readProjectName(projectId: string): string {
    try {
      const projectsDirectory = this.pathResolver.resolveEnv('PROJECTS_DIR', './data/projects');
      const projectInfoPath = path.join(projectsDirectory, projectId, 'projectinfo.json');
      if (!fs.existsSync(projectInfoPath)) return projectId;
      const raw = JSON.parse(fs.readFileSync(projectInfoPath, 'utf-8')) as {
        projectName?: string;
        name?: string;
      };
      return raw.projectName || raw.name || projectId;
    } catch (error) {
      this.logger.warn(`[小程序登录] 读取 projectinfo.json 失败，回退 projectId | projectId="${projectId}" error="${(error as Error).message}"`);
      return projectId;
    }
  }
}

/** Token-pair type for Controller use (keep types centrally managed) */
export type { WechatMpTokenPair };
