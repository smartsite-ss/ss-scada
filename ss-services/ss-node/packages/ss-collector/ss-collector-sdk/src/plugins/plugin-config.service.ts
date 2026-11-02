// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginRuntimeConfig {
  /** Isolation mode: in_process | worker_thread | child_process */
  isolationMode?: string;
  /** Plugin activation state (persisted, restored after restart) */
  activated?: boolean;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/**
 * Collection plugin runtime configuration persistence service
 *
 * - each plugin's config is stored separately at {PLUGIN_CONFIG_DIR}/{protocol}.json
 * - all existing configs are auto-loaded at startup
 * - runtime read/write goes through an in-memory cache + immediate disk write
 */
@Injectable()
export class PluginConfigService implements OnModuleInit {
  private readonly logger = new Logger(PluginConfigService.name);

  /** Config storage root directory */
  private readonly configDir: string;

  /** In-memory cache: protocol -> PluginRuntimeConfig */
  private readonly cache = new Map<string, PluginRuntimeConfig>();

  constructor(
    private readonly configService: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {
    const configured =
      this.configService.get<string>('PLUGIN_CONFIG_DIR') || process.env['PLUGIN_CONFIG_DIR'];
    this.configDir = configured
      ? this.resolvePath(configured)
      : path.join(this.getProjectRoot(), 'data', 'plugin-configs');
  }

  /**
   * Get the absolute path of the ss-services/ss-node project root directory
   *
   * Relative-path basis:
   * - dev mode: walk up 5 levels from __dirname = ss-services/ss-node
   *   (this file lives at packages/ss-collector/ss-collector-sdk/dist/plugins/)
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *
   * Kept consistent with app.module.ts getDatabaseConfig() and collector-bootstrap.service.ts resolveProjectsDir().
   */
  private getProjectRoot(): string {
    return this.pathResolver.getProjectRoot();
  }

  private resolvePath(p: string): string {
    return this.pathResolver.resolve(p);
  }

  async onModuleInit(): Promise<void> {
    this.ensureDir(this.configDir);
    await this.loadAllConfigs();
    this.logger.log(`Plugin config dir: ${this.configDir} (${this.cache.size} configs loaded)`);
  }

  // -----------------------------------------------------------------------
  //  Read
  // -----------------------------------------------------------------------

  /** Get the runtime config of a plugin (memory cache first) */
  getConfig(protocol: string): PluginRuntimeConfig {
    return this.cache.get(protocol) ?? {};
  }

  /** Get the isolation-mode config of a plugin; returns undefined if not configured */
  getIsolationMode(protocol: string): string | undefined {
    return this.cache.get(protocol)?.isolationMode;
  }

  /** Get the config map of all configured plugins */
  getAllConfigs(): ReadonlyMap<string, PluginRuntimeConfig> {
    return this.cache;
  }

  // -----------------------------------------------------------------------
  //  Write
  // -----------------------------------------------------------------------

  /**
   * Update the runtime config of a plugin
   *
   * - updates both the in-memory cache and the disk file
   * - fields passed as null / undefined are not overwritten (original value kept)
   */
  saveConfig(protocol: string, partial: Partial<PluginRuntimeConfig>): PluginRuntimeConfig {
    const existing = this.cache.get(protocol) ?? {};
    const merged: PluginRuntimeConfig = { ...existing, ...partial };

    // Drop undefined fields
    for (const key of Object.keys(merged) as (keyof PluginRuntimeConfig)[]) {
      if (merged[key] === undefined) delete merged[key];
    }

    this.cache.set(protocol, merged);
    this.writeConfigFile(protocol, merged);
    this.logger.log(`Plugin config saved: ${protocol} → ${JSON.stringify(merged)}`);

    return merged;
  }

  /**
   * Update the plugin isolation mode (convenience method)
   */
  setIsolationMode(protocol: string, mode: string): PluginRuntimeConfig {
    return this.saveConfig(protocol, { isolationMode: mode });
  }

  /** Get the persisted activation state of a plugin */
  getActivated(protocol: string): boolean | undefined {
    return this.cache.get(protocol)?.activated;
  }

  /** Persist the activation state of a plugin */
  setActivated(protocol: string, activated: boolean): PluginRuntimeConfig {
    return this.saveConfig(protocol, { activated });
  }

  /** Delete the config file of a plugin */
  deleteConfig(protocol: string): void {
    this.cache.delete(protocol);
    const filePath = this.getConfigFilePath(protocol);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.logger.log(`Plugin config deleted: ${protocol}`);
    }
  }

  // -----------------------------------------------------------------------
  //  File I/O
  // -----------------------------------------------------------------------

  private getConfigFilePath(protocol: string): string {
    return path.join(this.configDir, `${protocol}.json`);
  }

  /** Scan and load all *.json config files at startup */
  private async loadAllConfigs(): Promise<void> {
    if (!fs.existsSync(this.configDir)) return;

    const files = fs.readdirSync(this.configDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const protocol = file.replace('.json', '');
      const config = this.readConfigFile(protocol);
      if (config) {
        this.cache.set(protocol, config);
      }
    }
    this.logger.debug(`Loaded ${this.cache.size} plugin config(s) from ${this.configDir}`);
  }

  private readConfigFile(protocol: string): PluginRuntimeConfig | null {
    const filePath = this.getConfigFilePath(protocol);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PluginRuntimeConfig;
      // Basic validation
      if (typeof parsed !== 'object' || parsed === null) {
        this.logger.warn(`Invalid plugin config: ${filePath}`);
        return null;
      }
      return parsed;
    } catch (err) {
      this.logger.warn(`Failed to read plugin config ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  private writeConfigFile(protocol: string, config: PluginRuntimeConfig): void {
    this.ensureDir(this.configDir);
    const filePath = this.getConfigFilePath(protocol);
    try {
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error(`Failed to write plugin config ${filePath}: ${(err as Error).message}`);
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
