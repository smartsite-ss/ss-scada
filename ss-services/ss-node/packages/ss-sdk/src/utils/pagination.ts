// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { PaginatedResult } from '../types';

/**
 * Pagination utilities
 *
 * Provides convenient methods for building pagination query parameters and pagination results.
 */
export class PaginationUtil {
  /**
   * Build pagination query parameters (for ORM skip/take such as TypeORM/Prisma)
   * @param page page number (starting from 1)
   * @param pageSize items per page
   * @returns `{ skip, take }` query parameters
   */
  static buildQuery(page: number, pageSize: number): { skip: number; take: number } {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.floor(pageSize));
    return {
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    };
  }

  /**
   * Build a pagination result
   * @param items the current page's data
   * @param total total record count
   * @param page the current page number
   * @param pageSize items per page
   * @returns the normalized pagination result
   */
  static buildResult<T>(
    items: T[],
    total: number,
    page: number,
    pageSize: number,
  ): PaginatedResult<T> {
    const safePageSize = Math.max(1, Math.floor(pageSize));
    return {
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / safePageSize),
      },
    };
  }
}
