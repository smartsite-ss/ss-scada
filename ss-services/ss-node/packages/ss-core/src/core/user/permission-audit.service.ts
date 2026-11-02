// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Inject } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { PermissionAuditLog } from './entities/permission-audit-log.entity';

/**
 * Audit-log query params
 */
export interface AuditLogQueryDto {
  /** Page number (starting from 1) */
  page?: number;
  /** Items per page */
  pageSize?: number;
  /** Operator ID */
  operatorId?: string;
  /** Operation type */
  action?: string;
  /** Target type */
  targetType?: string;
  /** Target ID */
  targetId?: string;
  /** Start time */
  startDate?: string;
  /** End time */
  endDate?: string;
}

/**
 * Audit-log creation params
 */
export interface CreateAuditLogDto {
  operatorId: string;
  operatorName: string;
  action: string;
  targetType: string;
  targetId: string;
  changes?: Record<string, unknown> | null;
  ipAddress?: string;
}

/**
 * Permission-change audit service - added in v7.0
 *
 * Records all permission-related change operations:
 *   - Role creation/deletion
 *   - Role permission-code modification
 *   - Data-authorization changes (project/group/device)
 *   - User role assignment/revocation
 */
@Injectable()
export class PermissionAuditService {
  constructor(
    @Inject(getRepositoryToken(PermissionAuditLog))
    private readonly auditRepo: Repository<PermissionAuditLog>,
  ) {}

  /**
   * Record one audit log
   */
  async log(dto: CreateAuditLogDto): Promise<PermissionAuditLog> {
    const log = this.auditRepo.create({
      operatorId: dto.operatorId,
      operatorName: dto.operatorName,
      action: dto.action,
      targetType: dto.targetType,
      targetId: dto.targetId,
      changes: dto.changes ?? null,
      ipAddress: dto.ipAddress ?? null,
    });
    return this.auditRepo.save(log);
  }

  /**
   * Query audit logs (supports pagination and filtering)
   */
  async findAll(
    query: AuditLogQueryDto = {},
  ): Promise<{ items: PermissionAuditLog[]; total: number }> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const where: FindOptionsWhere<PermissionAuditLog> = {};

    if (query.operatorId) {
      where.operatorId = query.operatorId;
    }
    if (query.action) {
      where.action = query.action;
    }
    if (query.targetType) {
      where.targetType = query.targetType;
    }
    if (query.targetId) {
      where.targetId = query.targetId;
    }

    const [items, total] = await this.auditRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items, total };
  }

  /**
   * Query audit logs by operator
   */
  async findByOperator(
    operatorId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: PermissionAuditLog[]; total: number }> {
    return this.findAll({ operatorId, page, pageSize });
  }

  /**
   * Query audit logs by target
   */
  async findByTarget(
    targetType: string,
    targetId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: PermissionAuditLog[]; total: number }> {
    return this.findAll({ targetType, targetId, page, pageSize });
  }

  /**
   * Query audit logs by time range
   */
  async findByDateRange(
    startDate: string,
    endDate: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: PermissionAuditLog[]; total: number }> {
    const _where: FindOptionsWhere<PermissionAuditLog> = {};
    if (startDate && endDate) {
      // Use a simpler approach — filter in service layer for SQLite compatibility
    }

    const [items, _total] = await this.auditRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Filter by date range in memory (TypeORM date filtering varies by DB)
    let filtered = items;
    if (startDate) {
      filtered = filtered.filter((item) => item.createdAt >= new Date(startDate));
    }
    if (endDate) {
      filtered = filtered.filter((item) => item.createdAt <= new Date(endDate));
    }

    return { items: filtered, total: filtered.length };
  }

  /**
   * Get the latest N audit logs
   */
  async findRecent(limit = 50): Promise<PermissionAuditLog[]> {
    return this.auditRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
