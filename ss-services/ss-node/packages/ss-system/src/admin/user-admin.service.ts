// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { User, UserRole, ScadaWebSocketGateway, EventBusService } from '@ss-node/ss-core';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

export interface UserQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface AdminUserListResponse {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class UserAdminService {
  private readonly logger = new Logger(UserAdminService.name);

  constructor(
    @Inject(getRepositoryToken(User))
    private readonly userRepo: Repository<User>,
    @Inject(ScadaWebSocketGateway)
    private readonly wsGateway: ScadaWebSocketGateway,
    private readonly eventBusService: EventBusService,
  ) {}

  /** Full user list */
  async listUsers(query: UserQuery): Promise<AdminUserListResponse> {
    const { page = 1, pageSize = 20, search, role, isActive } = query;
    const where: any = {};

    if (search) {
      where.username = Like(`%${search}%`);
    }
    if (role) {
      where.role = role;
    }
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await this.userRepo.findAndCount({
      where,
      select: [
        'id',
        'username',
        'email',
        'displayName',
        'role',
        'isActive',
        'createdAt',
        'updatedAt',
      ],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { data, total, page, pageSize };
  }

  /** User details */
  async getUserDetail(id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id },
      select: [
        'id',
        'username',
        'email',
        'displayName',
        'role',
        'isActive',
        'createdAt',
        'updatedAt',
      ],
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return user;
  }

  /** Enable/disable a user */
  async toggleUserStatus(id: string, isActive: boolean): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    user.isActive = isActive;
    const saved = await this.userRepo.save(user);

    // When disabling a user, force them offline
    if (!isActive) {
      this.forceLogout(id);
    }

    return saved;
  }

  /** Role change */
  async updateUserRole(id: string, role: UserRole): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (!Object.values(UserRole).includes(role)) {
      throw new BadRequestException('无效的角色');
    }

    user.role = role;
    return this.userRepo.save(user);
  }

  /** Reset password */
  async resetPassword(id: string): Promise<{ newPassword: string }> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const newPassword = crypto.randomBytes(8).toString('hex');
    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);

    this.logger.log(`Password reset for user: ${user.username}`);
    return { newPassword };
  }

  /** Delete user */
  async deleteUser(id: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    // Prevent deleting the last admin
    if (user.role === UserRole.ADMIN) {
      const adminCount = await this.userRepo.count({ where: { role: UserRole.ADMIN } });
      if (adminCount <= 1) {
        throw new BadRequestException('不能删除最后一个管理员');
      }
    }

    // Force offline
    this.forceLogout(id);

    await this.userRepo.delete(id);
    this.logger.log(`User deleted: ${user.username}`);
  }

  /** Force offline */
  private forceLogout(userId: string): void {
    try {
      this.wsGateway.sendToUser(userId, 'force:logout', {
        message: 'You have been logged out by administrator',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Failed to force logout user ${userId}: ${error.message}`);
    }
  }
}
