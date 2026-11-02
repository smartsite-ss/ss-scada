// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PluginRegistry } from './plugin-registry';
import { CollectorPluginMeta, DiscoveredPlugin } from './plugin.types';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PluginDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(PluginDiscoveryService.name);

  constructor(
    private readonly registry: PluginRegistry,
    private readonly pathResolver: PathResolverService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.discoverPlugins();
  }

  /**
   * Scan installed collection plugins
   */
  async discoverPlugins(): Promise<DiscoveredPlugin[]> {
    const discovered: DiscoveredPlugin[] = [];
    const scanPaths = this.getScanPaths();

    for (const scanPath of scanPaths) {
      if (!fs.existsSync(scanPath)) {
        this.logger.debug(`Plugin scan path not found: ${scanPath}`);
        continue;
      }

      let packages: fs.Dirent[];
      try {
        packages = fs
          .readdirSync(scanPath, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith('ss-collector-'));
      } catch {
        continue;
      }

      for (const pkg of packages) {
        try {
          const plugin = await this.loadPluginMeta(path.join(scanPath, pkg.name));
          if (plugin) {
            discovered.push(plugin);
          }
        } catch (error) {
          this.logger.error(
            `Failed to load plugin meta for ${pkg.name}: ${(error as Error).message}`,
          );
        }
      }
    }

    this.logger.log(`Discovered ${discovered.length} collector plugins`);
    return discovered;
  }

  /**
   * Get the list of scan paths
   *
   * Relative-path basis:
   * - dev mode: walk up 5 levels from __dirname = ss-services/ss-node
   *   (this file lives at packages/ss-collector/ss-collector-sdk/dist/plugins/)
   *   in dev mode it scans packages/ss-collector/ (source plugins); node_modules/@ss-data does not exist
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *   in prod mode it scans node_modules/@ss-data (installed plugins); packages/ss-collector does not exist
   *
   * Fix history: previously resolved via process.cwd(), but in dev mode cwd = apps/ss-node-server,
   * which resolved packages/ss-collector to apps/ss-node-server/packages/ss-collector (non-existent),
   * so plugins could not be found in dev mode.
   */
  private getScanPaths(): string[] {
    const paths: string[] = [];
    const projectRoot = this.pathResolver.getProjectRoot();

    const nodeModules = path.resolve(projectRoot, 'node_modules', '@ss-data');
    if (fs.existsSync(nodeModules)) {
      paths.push(nodeModules);
    }

    const packagesDir = path.resolve(projectRoot, 'packages', 'ss-collector');
    if (fs.existsSync(packagesDir)) {
      paths.push(packagesDir);
    }

    return paths;
  }

  /**
   * Load the metadata of a single plugin
   */
  private async loadPluginMeta(pkgPath: string): Promise<DiscoveredPlugin | null> {
    const pkgJsonPath = path.join(pkgPath, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return null;

    let pkgJson: any;
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    } catch {
      return null;
    }

    const meta: CollectorPluginMeta = pkgJson.collectorPlugin;
    if (!meta?.protocol) {
      return null;
    }

    this.validateMeta(meta);

    const discovered: DiscoveredPlugin = {
      meta,
      packageName: pkgJson.name,
      packageVersion: pkgJson.version,
      status: 'discovered',
    };

    // Attempt to dynamically load the module
    try {
      const module = await import(pkgJson.name);
      if (module && module.default?.adapterToken) {
        discovered.module = module;
        discovered.adapter = module.default;
      }
    } catch {
      this.logger.debug(
        `Plugin ${meta.protocol} discovered but module not loaded (may need registration)`,
      );
    }

    return discovered;
  }

  /**
   * Validate plugin metadata
   */
  private validateMeta(meta: CollectorPluginMeta): void {
    const required: (keyof CollectorPluginMeta)[] = [
      'protocol',
      'displayName',
      'version',
      'connectionSchema',
      'category',
      'transport',
      'supportedDataTypes',
      'enabledByDefault',
    ];
    for (const field of required) {
      if (meta[field] === undefined || meta[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }
}
