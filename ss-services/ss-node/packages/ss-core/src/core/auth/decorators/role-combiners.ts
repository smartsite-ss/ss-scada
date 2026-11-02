// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { applyDecorators } from '@nestjs/common';
import { Roles } from './roles.decorator';
import { UserRole } from '../../user/entities/user.entity';

/**
 * Read-only role-combination decorator
 *
 * Equivalent to `@Roles(UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)`,
 * for GET query-type endpoints.
 *
 * Usage:
 * ```typescript
 * @Get()
 * @ReadRoles()
 * async findAll(...) { ... }
 * ```
 */
export function ReadRoles() {
  return applyDecorators(Roles(UserRole.ADMIN, UserRole.USER, UserRole.VIEWER));
}

/**
 * Read-write role-combination decorator
 *
 * Equivalent to `@Roles(UserRole.ADMIN, UserRole.USER)`,
 * for POST/PATCH/DELETE and other mutation-type endpoints.
 *
 * Usage:
 * ```typescript
 * @Post()
 * @WriteRoles()
 * async create(...) { ... }
 * ```
 */
export function WriteRoles() {
  return applyDecorators(Roles(UserRole.ADMIN, UserRole.USER));
}
