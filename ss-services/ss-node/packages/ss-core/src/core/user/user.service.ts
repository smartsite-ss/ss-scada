// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Inject,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User, UserRole } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { RegisterDto } from '../auth/dto/register.dto';
import { I18nService } from '@ss-node/ss-i18n';
import { ErrorFactory } from '../error-factory';

export interface CreateUserDto {
  username: string;
  password: string;
  email: string;
  displayName?: string;
  roleId?: string;
  positionId?: string;
  phone?: string;
}

export interface UpdateUserDto {
  displayName?: string;
  email?: string;
  roleId?: string;
  positionId?: string;
  phone?: string;
  avatar?: string;
  isActive?: boolean;
}

@Injectable()
export class UserService {
  private readonly err: ErrorFactory;

  constructor(
    @Inject(getRepositoryToken(User))
    private userRepository: Repository<User>,
    @Inject(getRepositoryToken(Role))
    private roleRepository: Repository<Role>,
    @Inject(I18nService)
    private i18nService: I18nService,
  ) {
    this.err = new ErrorFactory(this.i18nService);
  }

  async findById(id: string): Promise<User> {
    return this.userRepository.findOne({
      where: { id },
      relations: ['roleEntity', 'position'],
    });
  }

  async findByUsername(username: string): Promise<User> {
    return this.userRepository.findOne({ where: { username } });
  }

  async findByUsernameOrEmail(username: string, email: string): Promise<User> {
    return this.userRepository.findOne({
      where: [{ username }, { email }],
    });
  }

  async createUser(registerDto: RegisterDto): Promise<User> {
    const existing = await this.findByUsernameOrEmail(registerDto.username, registerDto.email);
    if (existing) {
      this.err.conflict('auth.register.failed_user_exists');
    }
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Find the user role as the default role for newly registered users
    let roleId: string | null = null;
    const userRole = await this.roleRepository.findOne({ where: { code: 'user' } });
    if (userRole) {
      roleId = userRole.id;
    }

    const user = this.userRepository.create({
      ...registerDto,
      password: hashedPassword,
      role: UserRole.USER,
      roleId,
    });
    return this.userRepository.save(user);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isOldPasswordValid) {
      throw new UnauthorizedException('当前密码不正确');
    }

    if (oldPassword === newPassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepository.save(user);
  }

  async updateProfile(
    userId: string,
    updates: { displayName?: string; email?: string },
  ): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (updates.email && updates.email !== user.email) {
      const emailExists = await this.userRepository.findOne({ where: { email: updates.email } });
      if (emailExists) {
        throw new ConflictException('邮箱已被占用');
      }
    }

    if (updates.displayName !== undefined) user.displayName = updates.displayName;
    if (updates.email !== undefined) user.email = updates.email;

    return this.userRepository.save(user);
  }

  // ──────── Admin user management (added in v6.0) ────────

  /** Query all users (admin) */
  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      relations: ['roleEntity', 'position'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Admin creates a user (with role/position assignment) */
  async adminCreateUser(dto: CreateUserDto): Promise<User> {
    const existing = await this.findByUsernameOrEmail(dto.username, dto.email);
    if (existing) {
      throw new ConflictException('用户名或邮箱已存在');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepository.create({
      username: dto.username,
      password: hashedPassword,
      email: dto.email,
      displayName: dto.displayName || dto.username,
      phone: dto.phone || '',
      roleId: dto.roleId || null,
      positionId: dto.positionId || null,
    });

    // Sync the role snapshot field
    if (dto.roleId) {
      const role = await this.roleRepository.findOne({ where: { id: dto.roleId } });
      if (role) {
        user.role = role.code as any;
      }
    }

    return this.userRepository.save(user);
  }

  /** Admin updates a user */
  async adminUpdateUser(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('用户不存在');

    if (dto.displayName !== undefined) user.displayName = dto.displayName;
    if (dto.email !== undefined && dto.email !== user.email) {
      const emailExists = await this.userRepository.findOne({ where: { email: dto.email } });
      if (emailExists) throw new ConflictException('邮箱已被占用');
      user.email = dto.email;
    }
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.avatar !== undefined) user.avatar = dto.avatar;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    // Sync the role snapshot field
    if (dto.roleId !== undefined) {
      user.roleId = dto.roleId || null;
      if (dto.roleId) {
        const role = await this.roleRepository.findOne({ where: { id: dto.roleId } });
        if (role) user.role = role.code as any;
      }
    }
    if (dto.positionId !== undefined) {
      user.positionId = dto.positionId || null;
    }

    return this.userRepository.save(user);
  }

  /** Assign a role */
  async assignRole(userId: string, roleId: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('用户不存在');

    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException('角色不存在');

    user.roleId = roleId;
    user.role = role.code as any;
    return this.userRepository.save(user);
  }

  /** Assign a position */
  async assignPosition(userId: string, positionId: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('用户不存在');

    user.positionId = positionId || null;
    return this.userRepository.save(user);
  }

  // ──────── WeChat scan-login user management ────────

  /** Query a user by wechatOpenId (scan login looks up an existing account) */
  async findByWechatOpenId(wechatOpenId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { wechatOpenId } });
  }

  /** Query a user by wechatUnionId (identify the same user across apps) */
  async findByWechatUnionId(wechatUnionId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { wechatUnionId } });
  }

  /**
   * Create a WeChat scan-login user
   *
   * - username: wechat_{first 8 chars of openid}, with a random suffix appended on conflict
   * - password: random 32 chars (bcrypt hashed), unknown to the user, only to satisfy the NOT NULL constraint
   * - email: {openid}@wechat.local placeholder (satisfies the unique constraint; admin can later have the user fill a real email)
   * - role: viewer (read-only)
   * - authProvider: wechat
   */
  async createWechatUser(params: {
    wechatOpenId: string;
    wechatUnionId?: string;
    nickname?: string;
    avatarUrl?: string;
  }): Promise<User> {
    const { wechatOpenId, wechatUnionId, nickname, avatarUrl } = params;
    const usernameSeed = `wechat_${wechatOpenId.slice(0, 8)}`;
    let username = usernameSeed;
    // Append a random suffix on username conflict
    while (await this.userRepository.findOne({ where: { username } })) {
      username = `${usernameSeed}_${crypto.randomBytes(2).toString('hex')}`;
    }
    // Email-conflict fallback
    let email = `${wechatOpenId}@wechat.local`;
    while (await this.userRepository.findOne({ where: { email } })) {
      email = `${wechatOpenId}_${crypto.randomBytes(2).toString('hex')}@wechat.local`;
    }

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    // Find the viewer role, set roleId + role snapshot
    let roleId: string | null = null;
    let roleCode: UserRole = UserRole.VIEWER;
    const viewerRole = await this.roleRepository.findOne({ where: { code: 'viewer' } });
    if (viewerRole) {
      roleId = viewerRole.id;
      roleCode = viewerRole.code as UserRole;
    }

    const user = this.userRepository.create({
      username,
      password: hashedPassword,
      email,
      displayName: nickname || username,
      avatar: avatarUrl || '',
      role: roleCode,
      roleId,
      authProvider: 'wechat',
      wechatOpenId,
      wechatUnionId: wechatUnionId || null,
      wechatNickname: nickname || null,
      wechatAvatarUrl: avatarUrl || null,
      isActive: true,
    });
    return this.userRepository.save(user);
  }

  /** Update a WeChat user's profile (nickname/avatar/unionId, refreshed after scanning) */
  async updateWechatProfile(
    userId: string,
    profile: {
      nickname?: string;
      avatarUrl?: string;
      unionId?: string;
    },
  ): Promise<void> {
    const patch: Partial<User> = {};
    if (profile.nickname !== undefined) {
      patch.wechatNickname = profile.nickname;
    }
    if (profile.avatarUrl !== undefined) {
      patch.wechatAvatarUrl = profile.avatarUrl;
      patch.avatar = profile.avatarUrl;
    }
    if (profile.unionId !== undefined) {
      patch.wechatUnionId = profile.unionId;
    }
    if (Object.keys(patch).length === 0) return;
    await this.userRepository.update(userId, patch);
  }

  // ──────── WeChat mini-program login user management ────────

  /** Query a bound user by mini-program openid (mini-program authorized login looks up the system account) */
  async findByWechatMpOpenId(wechatMpOpenId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { wechatMpOpenId } });
  }

  /** Bind a mini-program openid to a system account (first WeChat-login binding flow) */
  async bindWechatMpOpenId(userId: string, wechatMpOpenId: string): Promise<void> {
    await this.userRepository.update(userId, { wechatMpOpenId });
  }

  /** Unbind a mini-program openid (clear the binding relation) */
  async unbindWechatMpOpenId(userId: string): Promise<void> {
    await this.userRepository.update(userId, { wechatMpOpenId: null });
  }
}
