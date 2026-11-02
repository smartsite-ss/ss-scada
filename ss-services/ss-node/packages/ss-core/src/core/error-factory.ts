// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type { I18nService } from '@ss-node/ss-i18n';

/**
 * Unified i18n error factory
 *
 * Binds common HTTP exceptions with i18n translation, reducing repeated
 * `throw new XxxException(this.i18nService.tSync(...))` patterns in Services.
 *
 * Usage:
 * ```typescript
 * constructor(private i18nService: I18nService) {
 *   this.err = new ErrorFactory(i18nService);
 * }
 * private readonly err: ErrorFactory;
 *
 * // Usage
 * this.err.notFound('error.device.DEV_001', { id });
 * this.err.badRequest('error.validation.VAL_001', { field: 'name' });
 * this.err.conflict('error.device.DEV_002', { name });
 * ```
 */
export class ErrorFactory {
  constructor(private readonly i18n: I18nService) {}

  /**
   * Throw 404 NotFoundException (with i18n translation)
   */
  notFound(key: string, params?: Record<string, any>): never {
    throw new NotFoundException(params ? this.i18n.tSync(key, params) : this.i18n.tSync(key));
  }

  /**
   * Throw 400 BadRequestException (with i18n translation)
   */
  badRequest(key: string, params?: Record<string, any>): never {
    throw new BadRequestException(params ? this.i18n.tSync(key, params) : this.i18n.tSync(key));
  }

  /**
   * Throw 409 ConflictException (with i18n translation)
   */
  conflict(key: string, params?: Record<string, any>): never {
    throw new ConflictException(params ? this.i18n.tSync(key, params) : this.i18n.tSync(key));
  }
}
