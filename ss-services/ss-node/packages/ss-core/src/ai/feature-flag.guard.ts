// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Feature Flag Guard - P1-T07 AI Feature Flag gating
 *
 * Used together with the @RequireFeatureFlag() decorator.
 * Returns 403 Forbidden when the flag is off.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, FeatureFlagGuard)
 *   @RequireFeatureFlag(AI_FEATURE_FLAGS.CODEGEN)
 *   async generatePlugin() { ... }
 *
 * Related decision: D-012 (Feature Flag gating)
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService, AiFeatureFlag } from './feature-flag.service';

/** Decorator metadata key */
export const FEATURE_FLAG_KEY = 'ai:feature-flag';

/**
 * Feature Flag decorator - marks the flag required by an endpoint
 * @param flag - feature flag key name
 */
import { SetMetadata } from '@nestjs/common';
export const RequireFeatureFlag = (flag: AiFeatureFlag) => SetMetadata(FEATURE_FLAG_KEY, flag);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFlag = this.reflector.getAllAndOverride<AiFeatureFlag>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Endpoints without a flag marker are allowed through
    if (!requiredFlag) {
      return true;
    }

    if (this.featureFlagService.isEnabled(requiredFlag)) {
      return true;
    }

    throw new HttpException(
      {
        statusCode: HttpStatus.FORBIDDEN,
        message: `AI 功能未启用：${requiredFlag}`,
        error: 'Feature Flag Disabled',
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
