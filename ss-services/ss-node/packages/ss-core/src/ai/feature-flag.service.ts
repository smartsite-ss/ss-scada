// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Feature Flag Service - P1-T07 AI Feature Flag system
 *
 * 7 AI Feature Flags supporting:
 *   - Environment-variable level switch (AI_FEATURE_*, production-level gating)
 *   - Runtime query (for Guard / Controller usage)
 *   - Frontend reactive Composable (useFeatureFlag)
 *
 * All flags default to false (safe default).
 * Phase 2+ can migrate to a SystemConfigService database-driven (runtime) switch.
 *
 * Related decision: D-012 (Feature Flag gating)
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** AI feature flag key-name constants */
export const AI_FEATURE_FLAGS = {
  /** AI assistant panel (chat UI + streaming Q&A) */
  ASSISTANT: 'ai.assistant.enabled',
  /** Plugin code generation */
  CODEGEN: 'ai.codegen.enabled',
  /** Script code generation */
  SCRIPT: 'ai.script.enabled',
  /** Smart canvas creation */
  SCENE: 'ai.scene.enabled',
  /** Knowledge-base Q&A (RAG) */
  KB: 'ai.kb.enabled',
  /** Smart alarm analysis */
  ALARM: 'ai.alarm.enabled',
  /** CLI Agent */
  CLI: 'ai.cli.enabled',
} as const;

export type AiFeatureFlag = (typeof AI_FEATURE_FLAGS)[keyof typeof AI_FEATURE_FLAGS];

/** Env var mapping: Feature Flag -> env var name */
const FLAG_TO_ENV: Record<string, string> = {
  [AI_FEATURE_FLAGS.ASSISTANT]: 'AI_FEATURE_ASSISTANT_ENABLED',
  [AI_FEATURE_FLAGS.CODEGEN]: 'AI_FEATURE_CODEGEN_ENABLED',
  [AI_FEATURE_FLAGS.SCRIPT]: 'AI_FEATURE_SCRIPT_ENABLED',
  [AI_FEATURE_FLAGS.SCENE]: 'AI_FEATURE_SCENE_ENABLED',
  [AI_FEATURE_FLAGS.KB]: 'AI_FEATURE_KB_ENABLED',
  [AI_FEATURE_FLAGS.ALARM]: 'AI_FEATURE_ALARM_ENABLED',
  [AI_FEATURE_FLAGS.CLI]: 'AI_FEATURE_CLI_ENABLED',
};

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Check whether the given Feature Flag is enabled
   * @param flag - feature flag key name
   * @returns true = enabled, false = disabled
   */
  isEnabled(flag: AiFeatureFlag): boolean {
    const envKey = FLAG_TO_ENV[flag];
    if (!envKey) {
      this.logger.warn(`Unknown feature flag: ${flag}`);
      return false;
    }
    const value = this.configService.get<string>(envKey);
    return value === 'true';
  }

  /**
   * Return a snapshot of all current flag statuses
   * @returns { [flag: string]: boolean }
   */
  getAllFlags(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [flag, envKey] of Object.entries(FLAG_TO_ENV)) {
      result[flag] = this.configService.get<string>(envKey) === 'true';
    }
    return result;
  }

  /**
   * Check whether any of multiple flags is enabled
   */
  anyEnabled(flags: AiFeatureFlag[]): boolean {
    return flags.some((f) => this.isEnabled(f));
  }

  /**
   * Check whether all of multiple flags are enabled
   */
  allEnabled(flags: AiFeatureFlag[]): boolean {
    return flags.every((f) => this.isEnabled(f));
  }
}
