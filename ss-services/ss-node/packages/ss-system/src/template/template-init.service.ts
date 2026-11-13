// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { TemplateLoaderService } from './template-loader.service';
import { TemplateIndexService } from './template-index.service';

@Injectable()
export class TemplateInitService implements OnModuleInit {
  private readonly logger = new Logger(TemplateInitService.name);

  constructor(
    @Optional()
    private readonly templateLoader?: TemplateLoaderService,
    @Optional()
    private readonly indexService?: TemplateIndexService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Template init service started (JSON file mode)');
    await this.ensureTemplatesDirectory();
  }

  /**
   * Ensure the template directory exists and load templates for all languages (managed by TemplateLoaderService)
   */
  private async ensureTemplatesDirectory(): Promise<void> {
    const basePath = this.indexService?.getBasePath();
    if (basePath) {
      this.logger.log(`Template directory: ${basePath}`);
    }

    // The multi-language template library is managed centrally by TemplateLoaderService.loadAllLocales(),
    // so no single root index.json is rebuilt here
    if (this.templateLoader) {
      // loadAllLocales is already called in TemplateLoaderService's onModuleInit
      const stats = this.templateLoader.getCacheStats();
      this.logger.log(
        `Template library loaded: ${stats.count} templates, ${stats.industries.length} industries, ${stats.deviceTypes.length} device types`,
      );
    }
  }
}
