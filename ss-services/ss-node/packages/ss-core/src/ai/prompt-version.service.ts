// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI Prompt version-management Service - P2-T08
 *
 * Provides:
 *   1. Prompt template CRUD
 *   2. Version management (draft->active->archived transition)
 *   3. Template rendering ({{variable}} syntax)
 *   4. A/B test helper
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiPrompt, AiPromptVersion } from './entities/ai-prompt.entity';

/** DTO for creating a Prompt */
export interface CreatePromptDto {
  key: string;
  name: string;
  taskType?: string;
  description?: string;
}

/** DTO for creating a version */
export interface CreateVersionDto {
  promptId: string;
  version: string;
  systemPrompt: string;
  variables?: string;
  llmConfig?: string;
  changelog?: string;
  createdBy?: string;
}

/** Version flow operation */
export type VersionAction = 'publish' | 'archive' | 'rollback';

@Injectable()
export class PromptVersionService {
  private readonly logger = new Logger(PromptVersionService.name);

  constructor(
    @InjectRepository(AiPrompt)
    private readonly promptRepo: Repository<AiPrompt>,
    @InjectRepository(AiPromptVersion)
    private readonly versionRepo: Repository<AiPromptVersion>,
  ) {}

  // ============================================================
  //  Prompt template CRUD
  // ============================================================

  /** Create a Prompt template */
  async createPrompt(dto: CreatePromptDto): Promise<AiPrompt> {
    const prompt = this.promptRepo.create({
      key: dto.key,
      name: dto.name,
      taskType: dto.taskType || 'chat',
      description: dto.description,
    });
    return this.promptRepo.save(prompt);
  }

  /** Get all Prompt templates */
  async listPrompts(): Promise<AiPrompt[]> {
    return this.promptRepo.find({ order: { updatedAt: 'DESC' } });
  }

  /** Find Prompt by key */
  async getPromptByKey(key: string): Promise<AiPrompt | null> {
    return this.promptRepo.findOne({ where: { key } });
  }

  /** Update Prompt template */
  async updatePrompt(id: string, dto: Partial<CreatePromptDto>): Promise<void> {
    await this.promptRepo.update(id, dto);
  }

  // ============================================================
  //  Version management
  // ============================================================

  /** Create a new version (status = draft) */
  async createVersion(dto: CreateVersionDto): Promise<AiPromptVersion> {
    const version = this.versionRepo.create({
      promptId: dto.promptId,
      version: dto.version,
      status: 'draft',
      systemPrompt: dto.systemPrompt,
      variables: dto.variables || null,
      llmConfig: dto.llmConfig || null,
      changelog: dto.changelog || null,
      createdBy: dto.createdBy || null,
    });
    return this.versionRepo.save(version);
  }

  /** Get all versions of a Prompt */
  async listVersions(promptId: string): Promise<AiPromptVersion[]> {
    return this.versionRepo.find({
      where: { promptId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Get the active version */
  async getActiveVersion(promptId: string): Promise<AiPromptVersion | null> {
    return this.versionRepo.findOne({
      where: { promptId, status: 'active' },
    });
  }

  /** Get the active version's System Prompt (by prompt key) */
  async getActiveSystemPrompt(promptKey: string): Promise<string | null> {
    const prompt = await this.getPromptByKey(promptKey);
    if (!prompt) return null;
    const version = await this.getActiveVersion(prompt.id);
    return version?.systemPrompt || null;
  }

  /** Publish a version (draft -> active, old active -> archived) */
  async publishVersion(versionId: string): Promise<void> {
    const version = await this.versionRepo.findOne({ where: { id: versionId } });
    if (!version || version.status !== 'draft') {
      throw new Error(`版本 ${versionId} 不是 draft 状态，无法发布`);
    }

    // Archive the old active version
    const oldActive = await this.versionRepo.findOne({
      where: { promptId: version.promptId, status: 'active' },
    });
    if (oldActive) {
      await this.versionRepo.update(oldActive.id, { status: 'archived' });
    }

    // Publish the new version
    await this.versionRepo.update(versionId, { status: 'active' });
    await this.promptRepo.update(version.promptId, { activeVersionId: versionId });

    this.logger.log(`Prompt ${version.promptId} 版本已发布: ${version.version}`);
  }

  /** Archive a version (active -> archived) */
  async archiveVersion(versionId: string): Promise<void> {
    const version = await this.versionRepo.findOne({ where: { id: versionId } });
    if (!version || version.status !== 'active') {
      throw new Error(`版本 ${versionId} 不是 active 状态，无法归档`);
    }
    await this.versionRepo.update(versionId, { status: 'archived' });
    await this.promptRepo.update(version.promptId, { activeVersionId: null as any });
  }

  /** Roll back to a specified version */
  async rollbackToVersion(versionId: string): Promise<void> {
    const target = await this.versionRepo.findOne({ where: { id: versionId } });
    if (!target) throw new Error(`版本 ${versionId} 不存在`);

    // Archive the current active version
    const current = await this.versionRepo.findOne({
      where: { promptId: target.promptId, status: 'active' },
    });
    if (current) {
      await this.versionRepo.update(current.id, { status: 'archived' });
    }

    // Set the target version as active
    await this.versionRepo.update(versionId, { status: 'active' });
    await this.promptRepo.update(target.promptId, { activeVersionId: versionId });

    this.logger.log(`Prompt ${target.promptId} 已回滚到版本: ${target.version}`);
  }

  // ============================================================
  //  Template rendering
  // ============================================================

  /**
   * Render the System Prompt template ({{variable}} syntax)
   *
   * @param template  template string
   * @param variables key-value pairs of variables
   * @returns rendered string
   */
  renderTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] !== undefined ? variables[key] : match;
    });
  }

  /**
   * Get and render the active version's System Prompt
   *
   * @param promptKey Prompt identifier key
   * @param variables template variables
   * @returns rendered System Prompt, or null if it does not exist
   */
  async getRenderedSystemPrompt(
    promptKey: string,
    variables: Record<string, string> = {},
  ): Promise<string | null> {
    const template = await this.getActiveSystemPrompt(promptKey);
    if (!template) return null;
    return this.renderTemplate(template, variables);
  }

  // ============================================================
  //  A/B test helper
  // ============================================================

  /** Get the System Prompt of a specified version */
  async getVersionSystemPrompt(versionId: string): Promise<string | null> {
    const version = await this.versionRepo.findOne({ where: { id: versionId } });
    return version?.systemPrompt || null;
  }
}
