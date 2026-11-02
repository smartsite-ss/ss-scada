// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { WechatMpAuthService } from '../wechat-mp-auth.service';
import { UserService } from '../../../user/user.service';
import { AuthService } from '../../auth.service';
import { WechatApiService } from '../wechat-api.service';
import { AuditLoggerService } from '../../../../logger/audit-logger.service';
import { PathResolverService } from '../../../../path/path-resolver.service';
import { User } from '../../../user/entities/user.entity';

// Mock dependencies (consistent with the hand-written mock style in auth.service.spec)
const mockUserService = {
  findByWechatMpOpenId: jest.fn(),
  findByUsername: jest.fn(),
  findById: jest.fn(),
  bindWechatMpOpenId: jest.fn(),
  unbindWechatMpOpenId: jest.fn(),
};

const mockAuthService = {
  generateTokensForUser: jest.fn(),
};

const mockWechatApiService = {
  getCode2Session: jest.fn(),
};

const mockAuditLoggerService = {
  logSecurityEvent: jest.fn(),
};

const mockPathResolver = {
  resolveEnv: jest.fn(),
};

const mockProjectAuthorizationRepository = {
  find: jest.fn(),
};

const SESSION_RESPONSE = { openid: 'openid-mp-001', session_key: 'session-key' };
const TOKEN_PAIR = { accessToken: 'access-token', refreshToken: 'refresh-token' };

function buildBoundUser(overrides?: Partial<User>): User {
  return {
    id: 'user-1',
    username: 'operator',
    password: 'hashed',
    email: 'operator@test.com',
    displayName: '操作员',
    role: 'user',
    roleId: 'role-1',
    roleEntity: { name: '运维角色' },
    avatar: '',
    isActive: true,
    wechatMpOpenId: 'openid-mp-001',
    ...overrides,
  } as User;
}

describe('WechatMpAuthService', () => {
  let service: WechatMpAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWechatApiService.getCode2Session.mockResolvedValue(SESSION_RESPONSE);
    mockAuthService.generateTokensForUser.mockResolvedValue(TOKEN_PAIR);
    mockPathResolver.resolveEnv.mockReturnValue(path.join(os.tmpdir(), 'ss-wx-test-nonexistent'));
    mockProjectAuthorizationRepository.find.mockResolvedValue([]);
    service = new WechatMpAuthService(
      mockUserService as unknown as UserService,
      mockAuthService as unknown as AuthService,
      mockWechatApiService as unknown as WechatApiService,
      mockAuditLoggerService as unknown as AuditLoggerService,
      mockPathResolver as unknown as PathResolverService,
      mockProjectAuthorizationRepository as never,
    );
  });

  // ============================================================
  // login
  // ============================================================
  describe('login', () => {
    it('Unbound → bindingRequired=true and no token delivered', async () => {
      mockUserService.findByWechatMpOpenId.mockResolvedValue(null);

      const result = await service.login('mock-code');

      expect(result.bindingRequired).toBe(true);
      expect(result.tokenPair).toBeNull();
      expect(result.userInformation).toBeNull();
      expect(result.authorizedProjects).toEqual([]);
      expect(mockAuthService.generateTokensForUser).not.toHaveBeenCalled();
    });

    it('Bound and activated → issues Token + user info', async () => {
      const boundUser = buildBoundUser();
      mockUserService.findByWechatMpOpenId.mockResolvedValue(boundUser);
      mockUserService.findById.mockResolvedValue(boundUser);

      const result = await service.login('mock-code');

      expect(result.bindingRequired).toBe(false);
      expect(result.tokenPair).toEqual(TOKEN_PAIR);
      expect(result.userInformation).toEqual({
        userId: 'user-1',
        username: 'operator',
        nickname: '操作员',
        avatarUrl: null,
        roleNames: ['运维角色'],
      });
      expect(mockAuthService.generateTokensForUser).toHaveBeenCalledWith({
        id: 'user-1',
        username: 'operator',
        role: 'user',
      });
    });

    it('Bound but account disabled → UnauthorizedException', async () => {
      mockUserService.findByWechatMpOpenId.mockResolvedValue(buildBoundUser({ isActive: false }));

      await expect(service.login('mock-code')).rejects.toThrow(UnauthorizedException);
      expect(mockAuthService.generateTokensForUser).not.toHaveBeenCalled();
    });

    it('Authorized projects: multiple grants in the same project take the highest permission; projectName falls back to projectId', async () => {
      const boundUser = buildBoundUser();
      mockUserService.findByWechatMpOpenId.mockResolvedValue(boundUser);
      mockUserService.findById.mockResolvedValue(boundUser);
      mockProjectAuthorizationRepository.find.mockResolvedValue([
        { roleId: 'role-1', projectId: 'demo-project', permission: 'read' },
        { roleId: 'role-1', projectId: 'demo-project', permission: 'admin' },
        { roleId: 'role-1', projectId: 'other-project', permission: 'write' },
        { roleId: 'role-1', projectId: 'unknown-project', permission: 'invalid-level' },
      ]);

      const result = await service.login('mock-code');

      expect(result.authorizedProjects).toHaveLength(3);
      expect(result.authorizedProjects).toContainEqual({
        projectId: 'demo-project',
        projectName: 'demo-project',
        permissionLevel: 'admin',
      });
      expect(result.authorizedProjects).toContainEqual({
        projectId: 'other-project',
        projectName: 'other-project',
        permissionLevel: 'write',
      });
      // Illegal permission level is downgraded to read
      expect(result.authorizedProjects).toContainEqual({
        projectId: 'unknown-project',
        projectName: 'unknown-project',
        permissionLevel: 'read',
      });
    });

    it('Authorized projects: read the display name when projectinfo.json exists', async () => {
      const temporaryProjectsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-wx-projects-'));
      const projectDirectory = path.join(temporaryProjectsDirectory, 'demo-project');
      fs.mkdirSync(projectDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectory, 'projectinfo.json'),
        JSON.stringify({ projectId: 'demo-project', projectName: '演示工程' }),
        'utf-8',
      );
      mockPathResolver.resolveEnv.mockReturnValue(temporaryProjectsDirectory);

      const boundUser = buildBoundUser();
      mockUserService.findByWechatMpOpenId.mockResolvedValue(boundUser);
      mockUserService.findById.mockResolvedValue(boundUser);
      mockProjectAuthorizationRepository.find.mockResolvedValue([
        { roleId: 'role-1', projectId: 'demo-project', permission: 'read' },
      ]);

      const result = await service.login('mock-code');

      expect(result.authorizedProjects).toEqual([
        { projectId: 'demo-project', projectName: '演示工程', permissionLevel: 'read' },
      ]);

      fs.rmSync(temporaryProjectsDirectory, { recursive: true, force: true });
    });
  });

  // ============================================================
  // bind
  // ============================================================
  describe('bind', () => {
    it('Binding success → writes the binding relation and issues a Token', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      const account = buildBoundUser({ wechatMpOpenId: null, password: passwordHash });
      mockUserService.findByWechatMpOpenId.mockResolvedValue(null);
      mockUserService.findByUsername.mockResolvedValue(account);
      mockUserService.findById.mockResolvedValue(account);

      const result = await service.bind('mock-code', 'operator', 'password123');

      expect(mockUserService.bindWechatMpOpenId).toHaveBeenCalledWith('user-1', 'openid-mp-001');
      expect(result.tokenPair).toEqual(TOKEN_PAIR);
      expect(result.userInformation.username).toBe('operator');
    });

    it('openid already bound to another account → ConflictException ACCOUNT_ALREADY_BOUND', async () => {
      mockUserService.findByWechatMpOpenId.mockResolvedValue(buildBoundUser());

      const bindPromise = service.bind('mock-code', 'operator', 'password123');
      await expect(bindPromise).rejects.toThrow(ConflictException);
      await bindPromise.catch((error: ConflictException) => {
        const response = error.getResponse() as { code: string };
        expect(response.code).toBe('ACCOUNT_ALREADY_BOUND');
      });
      expect(mockUserService.bindWechatMpOpenId).not.toHaveBeenCalled();
    });

    it('Wrong password → UnauthorizedException and no binding relation written', async () => {
      const passwordHash = await bcrypt.hash('correctPassword', 10);
      mockUserService.findByWechatMpOpenId.mockResolvedValue(null);
      mockUserService.findByUsername.mockResolvedValue(buildBoundUser({ wechatMpOpenId: null, password: passwordHash }));

      await expect(service.bind('mock-code', 'operator', 'wrongPassword')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUserService.bindWechatMpOpenId).not.toHaveBeenCalled();
    });

    it('Target account already bound to another openid → ConflictException (rebinding forbidden)', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockUserService.findByWechatMpOpenId.mockResolvedValue(null);
      mockUserService.findByUsername.mockResolvedValue(
        buildBoundUser({ wechatMpOpenId: 'other-openid', password: passwordHash }),
      );

      await expect(service.bind('mock-code', 'operator', 'password123')).rejects.toThrow(
        ConflictException,
      );
      expect(mockUserService.bindWechatMpOpenId).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // unbind
  // ============================================================
  describe('unbind', () => {
    it('Unbind success → clears the binding relation', async () => {
      mockUserService.unbindWechatMpOpenId.mockResolvedValue(undefined);

      const result = await service.unbind('user-1');

      expect(mockUserService.unbindWechatMpOpenId).toHaveBeenCalledWith('user-1');
      expect(result.message).toBe('微信绑定已解除');
    });
  });
});
