// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../entities/system.entity';
import { EventBusService, PathResolverService } from '@ss-node/ss-core';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  CONFIG_METADATA_REGISTRY,
  CONFIG_CATEGORY_INFO,
  PENDING_RESTART_KEY,
  ConfigMetadata,
  ConfigMetadataHelper,
  ConfigCategory,
} from './config-metadata';

const ENCRYPTION_KEY =
  process.env.SYSTEM_CONFIG_ENCRYPTION_KEY || 'ss-v7-default-encryption-key-32b';
const SENSITIVE_PREFIX = 'ENC:';

/** Config item display view (metadata + current value) */
export interface ConfigItemView {
  key: string;
  category: ConfigCategory;
  categoryLabel: string;
  description: string;
  defaultValue?: string;
  type: string;
  enumValues?: string[];
  sensitive: boolean;
  editable: boolean;
  hotReloadable: boolean;
  restartRequired: boolean;
  envFile: boolean;
  validation?: { min?: number; max?: number; pattern?: string };
  /** Current effective value (sensitive fields masked) */
  value: string;
  /** Value source: env / db / default / null */
  source: 'env' | 'db' | 'default' | 'null';
}

/** Config update result */
export interface ConfigUpdateResult {
  key: string;
  value: string;
  restartRequired: boolean;
  hotReloadable: boolean;
  envFileUpdated: boolean;
  addedToPendingRestart: boolean;
}

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);
  private cache: Map<string, { value: string; type: string }> = new Map();
  private cacheInitialized = false;

  constructor(
    @Inject(getRepositoryToken(SystemConfig))
    private readonly configRepo: Repository<SystemConfig>,
    private readonly eventBusService: EventBusService,
    private readonly pathResolver: PathResolverService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshCache();
  }

  /** Get a config value (environment variables take precedence) */
  async get(key: string): Promise<string | null> {
    // Environment variables take precedence
    const envKey = key.toUpperCase().replace(/\./g, '_');
    if (process.env[envKey] !== undefined) {
      return process.env[envKey]!;
    }

    // Cache lookup
    if (this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      return this.decryptIfNeeded(cached.value);
    }

    // Database lookup
    const config = await this.configRepo.findOne({ where: { key } });
    if (config) {
      this.cache.set(key, { value: config.value, type: config.type });
      return this.decryptIfNeeded(config.value);
    }

    // Fall back to the metadata default value
    const meta = ConfigMetadataHelper.getByKey(key);
    if (meta?.defaultValue !== undefined) {
      return meta.defaultValue;
    }

    return null;
  }

  /** Set a config value */
  async set(
    key: string,
    value: string,
    description?: string,
    type?: string,
    sensitive?: boolean,
  ): Promise<SystemConfig> {
    let storedValue = value;
    if (sensitive) {
      storedValue = this.encrypt(value);
    }

    let config = await this.configRepo.findOne({ where: { key } });
    if (config) {
      config.value = storedValue;
      if (description !== undefined) config.description = description;
      if (type !== undefined) config.type = type;
      config.updatedAt = new Date();
    } else {
      config = this.configRepo.create({
        key,
        value: storedValue,
        description: description || '',
        type: type || 'string',
        updatedAt: new Date(),
      });
    }

    const saved = await this.configRepo.save(config);
    this.cache.set(key, { value: storedValue, type: config.type });

    // Hot-reload notification
    this.eventBusService.emitConfigChanged({
      configType: 'system',
      targetId: key,
      changes: { key, value: sensitive ? '***' : value },
      timestamp: Date.now(),
    });

    return saved;
  }

  /** Delete a config */
  async delete(key: string): Promise<void> {
    await this.configRepo.delete({ key });
    this.cache.delete(key);
  }

  /** Get all configs (DB ones only, sensitive fields masked) */
  async getAll(): Promise<SystemConfig[]> {
    const configs = await this.configRepo.find();
    return configs.map((c) => {
      if (c.value.startsWith(SENSITIVE_PREFIX)) {
        return { ...c, value: '***' };
      }
      return c;
    });
  }

  /** Refresh the cache */
  async refreshCache(): Promise<void> {
    try {
      const configs = await this.configRepo.find();
      this.cache.clear();
      for (const config of configs) {
        this.cache.set(config.key, { value: config.value, type: config.type });
      }
      this.cacheInitialized = true;
      this.logger.log(`Cache refreshed with ${configs.length} configs`);
    } catch (error) {
      this.logger.error(`Failed to refresh cache: ${error.message}`);
    }
  }

  // ==================== Metadata-related methods ====================

  /** Get all config item metadata */
  getMetadata(): ConfigMetadata[] {
    return ConfigMetadataHelper.getAll();
  }

  /** Get metadata grouped by category */
  getMetadataByCategory(): Record<ConfigCategory, ConfigMetadata[]> {
    return ConfigMetadataHelper.groupByCategory();
  }

  /** Get all config items (metadata + current value) — for frontend display */
  async getAllWithMeta(): Promise<ConfigItemView[]> {
    const result: ConfigItemView[] = [];
    const dbConfigs = await this.configRepo.find();
    const dbMap = new Map(dbConfigs.map((c) => [c.key, c]));

    for (const meta of this.getMetadata()) {
      const view = await this.buildConfigItemView(meta, dbMap.get(meta.key));
      result.push(view);
    }

    return result;
  }

  /** Get a single config item (metadata + current value) */
  async getWithMeta(key: string): Promise<ConfigItemView | null> {
    const meta = ConfigMetadataHelper.getByKey(key);
    if (!meta) return null;

    const dbConfig = await this.configRepo.findOne({ where: { key } });
    return this.buildConfigItemView(meta, dbConfig);
  }

  /** Update a config (with metadata validation, optionally writes back to the env file) */
  async setWithMeta(
    key: string,
    value: string,
    options: { writeEnv?: boolean; description?: string } = {},
  ): Promise<ConfigUpdateResult> {
    const meta = ConfigMetadataHelper.getByKey(key);
    if (!meta) {
      throw new BadRequestException(`配置项 ${key} 不在元数据注册表中`);
    }

    // Validate
    const validation = ConfigMetadataHelper.validateValue(meta, value);
    if (!validation.valid) {
      throw new BadRequestException(validation.error);
    }

    // Write to the database
    await this.set(key, value, options.description, meta.type, meta.sensitive);

    // Also update process.env (so hot reload takes effect immediately)
    process.env[key] = value;

    // Write back to the env file
    let envFileUpdated = false;
    if (options.writeEnv && meta.envFile) {
      envFileUpdated = this.writeEnvFile(key, value);
    }

    // Add to the pending-restart list (if a restart is required)
    let addedToPendingRestart = false;
    if (meta.restartRequired && !meta.hotReloadable) {
      await this.addToPendingRestart(key);
      addedToPendingRestart = true;
    }

    this.logger.log(
      `Config updated: ${key}=${meta.sensitive ? '***' : value}, ` +
        `restartRequired=${meta.restartRequired}, envFileUpdated=${envFileUpdated}`,
    );

    return {
      key,
      value: meta.sensitive ? '***' : value,
      restartRequired: meta.restartRequired,
      hotReloadable: meta.hotReloadable,
      envFileUpdated,
      addedToPendingRestart,
    };
  }

  /** Get the pending-restart list */
  async getRestartRequired(): Promise<string[]> {
    const raw = await this.get(PENDING_RESTART_KEY);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  /** Remove the given key from the pending-restart list */
  async removeFromPendingRestart(keys: string[]): Promise<void> {
    const current = await this.getRestartRequired();
    const remaining = current.filter((k) => !keys.includes(k));
    await this.set(PENDING_RESTART_KEY, JSON.stringify(remaining));
  }

  /** Clear the pending-restart list */
  async clearPendingRestart(): Promise<void> {
    await this.set(PENDING_RESTART_KEY, '[]');
  }

  // ==================== Private methods ====================

  private async buildConfigItemView(
    meta: ConfigMetadata,
    dbConfig?: SystemConfig,
  ): Promise<ConfigItemView> {
    // Value priority: env > db > default > null
    const envKey = meta.key.toUpperCase();
    let value: string;
    let source: 'env' | 'db' | 'default' | 'null';

    if (process.env[envKey] !== undefined) {
      value = process.env[envKey]!;
      source = 'env';
    } else if (dbConfig) {
      value = this.decryptIfNeeded(dbConfig.value);
      source = 'db';
    } else if (meta.defaultValue !== undefined) {
      value = meta.defaultValue;
      source = 'default';
    } else {
      value = '';
      source = 'null';
    }

    // Mask sensitive fields
    const displayValue = meta.sensitive && value ? '***' : value;

    return {
      key: meta.key,
      category: meta.category,
      categoryLabel: CONFIG_CATEGORY_INFO[meta.category].label,
      description: meta.description,
      defaultValue: meta.defaultValue,
      type: meta.type,
      enumValues: meta.enumValues,
      sensitive: meta.sensitive,
      editable: meta.editable,
      hotReloadable: meta.hotReloadable,
      restartRequired: meta.restartRequired,
      envFile: meta.envFile,
      validation: meta.validation,
      value: displayValue,
      source,
    };
  }

  private async addToPendingRestart(key: string): Promise<void> {
    const current = await this.getRestartRequired();
    if (!current.includes(key)) {
      current.push(key);
      await this.set(PENDING_RESTART_KEY, JSON.stringify(current));
    }
  }

  /** Write back to the env file (preserves comments + backup) */
  private writeEnvFile(key: string, value: string): boolean {
    try {
      const envFilePath = this.resolveEnvFilePath();
      if (!envFilePath || !fs.existsSync(envFilePath)) {
        this.logger.warn(`Env file not found: ${envFilePath}`);
        return false;
      }

      // Backup
      this.backupEnvFile(envFilePath);

      // Read and process line by line
      const content = fs.readFileSync(envFilePath, 'utf-8');
      const lines = content.split(/\r?\n/);
      let found = false;
      const newLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        // Preserve comments and blank lines
        if (trimmed.startsWith('#') || trimmed === '') {
          newLines.push(line);
          continue;
        }

        // Parse KEY=VALUE
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) {
          newLines.push(line);
          continue;
        }

        const lineKey = trimmed.substring(0, eqIdx).trim();
        if (lineKey === key) {
          newLines.push(`${key}=${value}`);
          found = true;
        } else {
          newLines.push(line);
        }
      }

      // Key not found → append at the end
      if (!found) {
        newLines.push(`${key}=${value}`);
      }

      fs.writeFileSync(envFilePath, newLines.join('\n'), 'utf-8');
      this.logger.log(`Env file updated: ${key}=${value}, file=${envFilePath}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to write env file: ${error.message}`);
      return false;
    }
  }

  /** Resolve the env file path (aligned with the buildEnvFilePaths() load chain) */
  private resolveEnvFilePath(): string | null {
    // Production: write to cwd/.env
    if (process.env.NODE_ENV === 'production') {
      const cwdEnv = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(cwdEnv)) return cwdEnv;
    }

    // Development: write to .env.{APP_ENV|dev} consistent with the startup load chain
    const projectRoot = this.pathResolver.getProjectRoot();
    const envTarget = `.env.${process.env.APP_ENV || 'dev'}`;
    const targetPath = path.join(projectRoot, envTarget);
    if (fs.existsSync(targetPath)) return targetPath;

    return null;
  }

  /** Back up the env file (keeps the 10 most recent) */
  private backupEnvFile(envFilePath: string): void {
    try {
      const dir = path.dirname(envFilePath);
      const ext = path.extname(envFilePath);
      const base = path.basename(envFilePath, ext);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(dir, `${base}.bak.${timestamp}${ext}`);

      fs.copyFileSync(envFilePath, backupPath);

      // Clean up backups beyond the 10 most recent
      const backups = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(`${base}.bak.`) && f.endsWith(ext))
        .sort()
        .reverse();
      for (const old of backups.slice(10)) {
        fs.unlinkSync(path.join(dir, old));
      }
    } catch (error) {
      this.logger.warn(`Backup env file failed: ${error.message}`);
    }
  }

  /** AES-256-GCM encryption */
  private encrypt(value: string): string {
    try {
      const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf-8');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(value, 'utf-8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      return `${SENSITIVE_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      this.logger.error(`Encryption failed: ${error.message}`);
      return value;
    }
  }

  /** AES-256-GCM decryption */
  private decrypt(encryptedValue: string): string {
    try {
      const parts = encryptedValue.replace(SENSITIVE_PREFIX, '').split(':');
      if (parts.length !== 3) return encryptedValue;

      const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf-8');
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');
      return decrypted;
    } catch (error) {
      this.logger.error(`Decryption failed: ${error.message}`);
      return encryptedValue;
    }
  }

  private decryptIfNeeded(value: string): string {
    if (value && value.startsWith(SENSITIVE_PREFIX)) {
      return this.decrypt(value);
    }
    return value;
  }
}
