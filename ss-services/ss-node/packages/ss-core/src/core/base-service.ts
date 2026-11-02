// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger, NotFoundException } from '@nestjs/common';
import { Repository, FindOptionsWhere } from 'typeorm';
import { PaginationDto, PaginationUtil, PaginatedResult } from '@ss-node/ss-sdk';

/**
 * Generic business-service base class
 *
 * Provides utility methods shared by business Services:
 * - Logger instance
 * - Pagination param calculation
 * - Pagination result construction
 * - findOneOrThrow (query and auto-throw NotFoundException)
 *
 * Usage:
 * ```typescript
 * export class DeviceService extends BaseService<Device> {
 *   constructor(
 *     @Inject(getRepositoryToken(Device)) private deviceRepo: Repository<Device>,
 *   ) {
 *     super(DeviceService.name);
 *   }
 * }
 * ```
 */
export abstract class BaseService<T> {
  protected readonly logger: Logger;

  constructor(serviceName: string) {
    this.logger = new Logger(serviceName);
  }

  /**
   * Calculate pagination params (skip + take)
   */
  protected getPaginationParams(query?: PaginationDto): { skip: number; take: number } {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    return PaginationUtil.buildQuery(page, pageSize);
  }

  /**
   * Build pagination result
   */
  protected buildPaginatedResult(
    items: T[],
    total: number,
    query?: PaginationDto,
  ): PaginatedResult<T> {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    return PaginationUtil.buildResult(items, total, page, pageSize);
  }

  /**
   * Query a single entity by condition, throw NotFoundException if not found
   *
   * @param repo TypeORM Repository
   * @param where query condition
   * @param entityName entity name (for error message)
   * @param relations optional relation loading
   */
  protected async findOneOrThrow(
    repo: Repository<T>,
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    entityName: string = 'entity',
    relations?: string[],
  ): Promise<T> {
    const entity = await repo.findOne({ where, relations });
    if (!entity) {
      throw new NotFoundException(`${entityName} not found`);
    }
    return entity;
  }
}
