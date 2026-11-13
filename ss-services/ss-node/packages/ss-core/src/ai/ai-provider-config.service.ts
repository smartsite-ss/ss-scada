// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI Provider config service - manages the global database table sys_ai_providers
 *
 * Provides CRUD operations for AI vendor configs, supporting encrypted API Key storage.
 * LLMProxyService reads config through this service at startup and on hot reload.
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AiProvider } from './entities/ai-provider.entity';
import { ProviderConfig } from './llm.types';
import { PROVIDER_PRESETS, ProviderPreset, findPreset } from './provider-presets';

const ENCRYPTION_KEY =
  process.env.SYSTEM_CONFIG_ENCRYPTION_KEY || 'ss-v7-default-encryption-key-32b';
const SENSITIVE_PREFIX = 'ENC:';

/** Create/update DTO */
export interface CreateAiProviderDto {
  providerId: string;
  name: string;
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  models?: string[];
  enabled?: boolean;
  sortOrder?: number;
  config?: Record<string, any>;
}

export type UpdateAiProviderDto = Partial<CreateAiProviderDto>;

/** View returned to the frontend (apiKey masked) */
export interface AiProviderView {
  id: string;
  providerId: string;
  name: string;
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  models: string[];
  enabled: boolean;
  sortOrder: number;
  config: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AiProviderConfigService {
  private readonly logger = new Logger(AiProviderConfigService.name);

  constructor(
    @InjectRepository(AiProvider)
    private readonly repo: Repository<AiProvider>,
  ) {}

  /** Query all vendor configs (apiKey masked) */
  async findAll(): Promise<AiProviderView[]> {
    const list = await this.repo.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    return list.map((e) => this.toView(e));
  }

  /** Query a single vendor config (returns the full apiKey for LLMProxyService) */
  async findById(id: string): Promise<AiProvider | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Query enabled vendor config by providerId */
  async findEnabledByProviderId(providerId: string): Promise<AiProvider | null> {
    return this.repo.findOne({ where: { providerId, enabled: 1 } });
  }

  /** Query all enabled vendor configs */
  async findEnabled(): Promise<AiProvider[]> {
    return this.repo.find({ where: { enabled: 1 }, order: { sortOrder: 'ASC' } });
  }

  /** Create a vendor config */
  async create(dto: CreateAiProviderDto): Promise<AiProviderView> {
    this.validateDto(dto);
    const entity = this.repo.create({
      providerId: dto.providerId,
      name: dto.name,
      apiKey: this.encrypt(dto.apiKey),
      apiBase: dto.apiBase,
      defaultModel: dto.defaultModel,
      models: JSON.stringify(dto.models || []),
      enabled: dto.enabled === false ? 0 : 1,
      sortOrder: dto.sortOrder ?? 0,
      config: JSON.stringify(dto.config || {}),
    });
    const saved = await this.repo.save(entity);
    this.logger.log(`AI Provider created: ${dto.name} (${dto.providerId})`);
    return this.toView(saved);
  }

  /** Update a vendor config */
  async update(id: string, dto: UpdateAiProviderDto): Promise<AiProviderView> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) {
      throw new BadRequestException(`AI Provider 不存在: ${id}`);
    }

    if (dto.providerId !== undefined) entity.providerId = dto.providerId;
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.apiKey !== undefined) entity.apiKey = this.encrypt(dto.apiKey);
    if (dto.apiBase !== undefined) entity.apiBase = dto.apiBase;
    if (dto.defaultModel !== undefined) entity.defaultModel = dto.defaultModel;
    if (dto.models !== undefined) entity.models = JSON.stringify(dto.models);
    if (dto.enabled !== undefined) entity.enabled = dto.enabled ? 1 : 0;
    if (dto.sortOrder !== undefined) entity.sortOrder = dto.sortOrder;
    if (dto.config !== undefined) entity.config = JSON.stringify(dto.config);

    const saved = await this.repo.save(entity);
    this.logger.log(`AI Provider updated: ${saved.name} (${saved.providerId})`);
    return this.toView(saved);
  }

  /** Delete a vendor config */
  async remove(id: string): Promise<void> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) {
      throw new BadRequestException(`AI Provider 不存在: ${id}`);
    }
    await this.repo.delete({ id });
    this.logger.log(`AI Provider deleted: ${entity.name} (${entity.providerId})`);
  }

  /** Toggle enabled/disabled */
  async toggleEnabled(id: string, enabled: boolean): Promise<AiProviderView> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) {
      throw new BadRequestException(`AI Provider 不存在: ${id}`);
    }
    entity.enabled = enabled ? 1 : 0;
    const saved = await this.repo.save(entity);
    this.logger.log(`AI Provider ${enabled ? 'enabled' : 'disabled'}: ${saved.name}`);
    return this.toView(saved);
  }

  /**
   * Get the complete ProviderConfig of a vendor by DB ID (decrypts apiKey, regardless of enabled state)
   *
   * Used for connection-test scenarios: a user may validate the config before enabling it.
   */
  async getProviderConfigById(id: string): Promise<ProviderConfig | null> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) return null;
    const extra = this.parseJson<Record<string, any>>(p.config, {});
    return {
      providerId: p.providerId as any,
      apiKey: this.decryptIfNeeded(p.apiKey),
      apiBase: p.apiBase,
      defaultModel: p.defaultModel,
      codegenModel: extra.codegenModel,
      liteModel: extra.liteModel,
      embeddingModel: extra.embeddingModel,
      embeddingDim: extra.embeddingDim,
      timeout: extra.timeout ?? 60000,
      maxRetries: extra.maxRetries ?? 3,
    } as ProviderConfig;
  }

  /**
   * Get the ProviderConfig list of enabled Providers (used by LLMProxyService init)
   * Returns the full config after decrypting apiKey
   */
  async getEnabledProviderConfigs(): Promise<ProviderConfig[]> {
    const providers = await this.findEnabled();
    return providers.map((p) => {
      const extra = this.parseJson<Record<string, any>>(p.config, {});
      return {
        providerId: p.providerId as any,
        apiKey: this.decryptIfNeeded(p.apiKey),
        apiBase: p.apiBase,
        defaultModel: p.defaultModel,
        codegenModel: extra.codegenModel,
        liteModel: extra.liteModel,
        embeddingModel: extra.embeddingModel,
        embeddingDim: extra.embeddingDim,
        timeout: extra.timeout ?? 60000,
        maxRetries: extra.maxRetries ?? 3,
      } as ProviderConfig;
    });
  }

  /**
   * Get all preset vendor templates (for the frontend vendor-selection list)
   */
  getPresets(): ProviderPreset[] {
    return PROVIDER_PRESETS;
  }

  /**
   * Ensure preset vendors are seeded into the database
   *
   * On first startup, write all preset vendors to the database (apiKey empty, enabled=0),
   * so the user only needs to fill in the API Key and enable it on the frontend.
   * Existing providerIds are skipped (user config is not overwritten).
   */
  async ensureDefaultProviders(): Promise<void> {
    try {
      const existing = await this.repo.find();
      const existingIds = new Set(existing.map((e) => e.providerId));

      const toInsert: AiProvider[] = [];
      PROVIDER_PRESETS.forEach((preset, index) => {
        if (!existingIds.has(preset.providerId)) {
          const entity = this.repo.create({
            providerId: preset.providerId,
            name: preset.name,
            apiKey: '', // the user fills this in on the frontend
            apiBase: preset.apiBase,
            defaultModel: preset.defaultModel,
            models: JSON.stringify(preset.models),
            enabled: 0, // disabled by default; takes effect after the user enables it
            sortOrder: index,
            config: JSON.stringify({
              codegenModel: preset.codegenModel,
              liteModel: preset.liteModel,
              embeddingModel: preset.embeddingModel,
              embeddingDim: preset.embeddingDim,
              timeout: preset.timeout,
              maxRetries: preset.maxRetries,
              region: preset.region,
              apiKeyUrl: preset.apiKeyUrl,
              supportsEmbedding: preset.supportsEmbedding,
              description: preset.description,
            }),
          });
          toInsert.push(entity);
        }
      });

      if (toInsert.length > 0) {
        await this.repo.save(toInsert);
        this.logger.log(
          `Seeded ${toInsert.length} preset AI Provider configs (disabled by default; add an API Key to enable)`,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to seed preset Provider configs: ${(err as Error).message}`);
    }
  }

  /**
   * Quickly create a vendor config from a preset template (API Key only)
   *
   * After the user selects a preset vendor, only the API Key is required; the rest is auto-filled from the template.
   */
  async createFromPreset(providerId: string, apiKey: string): Promise<AiProviderView> {
    const preset = findPreset(providerId);
    if (!preset) {
      throw new BadRequestException(`未知的供应商预设: ${providerId}`);
    }
    if (!apiKey?.trim()) {
      throw new BadRequestException('API Key 不能为空');
    }

    // check whether a config with the same providerId already exists
    const existing = await this.repo.findOne({ where: { providerId } });
    if (existing) {
      // if exists, update the API Key and enable it
      existing.apiKey = this.encrypt(apiKey);
      existing.enabled = 1;
      const saved = await this.repo.save(existing);
      this.logger.log(`AI Provider updated from preset: ${preset.name} (${providerId})`);
      return this.toView(saved);
    }

    // create a new config
    const entity = this.repo.create({
      providerId: preset.providerId,
      name: preset.name,
      apiKey: this.encrypt(apiKey),
      apiBase: preset.apiBase,
      defaultModel: preset.defaultModel,
      models: JSON.stringify(preset.models),
      enabled: 1, // enabled directly after creation from presets
      sortOrder: PROVIDER_PRESETS.findIndex((p) => p.providerId === providerId),
      config: JSON.stringify({
        codegenModel: preset.codegenModel,
        liteModel: preset.liteModel,
        embeddingModel: preset.embeddingModel,
        embeddingDim: preset.embeddingDim,
        timeout: preset.timeout,
        maxRetries: preset.maxRetries,
        region: preset.region,
        apiKeyUrl: preset.apiKeyUrl,
        supportsEmbedding: preset.supportsEmbedding,
        description: preset.description,
      }),
    });
    const saved = await this.repo.save(entity);
    this.logger.log(`AI Provider created from preset: ${preset.name} (${providerId})`);
    return this.toView(saved);
  }

  // ==================== Private methods ====================

  private validateDto(dto: CreateAiProviderDto): void {
    if (!dto.providerId?.trim()) {
      throw new BadRequestException('providerId 不能为空');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name 不能为空');
    }
    if (!dto.apiKey?.trim()) {
      throw new BadRequestException('apiKey 不能为空');
    }
    if (!dto.apiBase?.trim()) {
      throw new BadRequestException('apiBase 不能为空');
    }
    if (!dto.defaultModel?.trim()) {
      throw new BadRequestException('defaultModel 不能为空');
    }
  }

  private toView(entity: AiProvider): AiProviderView {
    return {
      id: entity.id,
      providerId: entity.providerId,
      name: entity.name,
      apiKey: entity.apiKey?.startsWith(SENSITIVE_PREFIX) ? '***' : entity.apiKey,
      apiBase: entity.apiBase,
      defaultModel: entity.defaultModel,
      models: this.parseJson(entity.models, []),
      enabled: entity.enabled === 1,
      sortOrder: entity.sortOrder,
      config: this.parseJson(entity.config, {}),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private parseJson<T>(str: string, fallback: T): T {
    try {
      return JSON.parse(str) as T;
    } catch {
      return fallback;
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
      this.logger.error(`Encryption failed: ${(error as Error).message}`);
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
      this.logger.error(`Decryption failed: ${(error as Error).message}`);
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
