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
    this.logger.log('模板初始化服务启动（JSON 文件模式）');
    await this.ensureTemplatesDirectory();
  }

  /**
   * Ensure the template directory exists and load templates for all languages (managed by TemplateLoaderService)
   */
  private async ensureTemplatesDirectory(): Promise<void> {
    const basePath = this.indexService?.getBasePath();
    if (basePath) {
      this.logger.log(`模板目录: ${basePath}`);
    }

    // The multi-language template library is managed centrally by TemplateLoaderService.loadAllLocales(),
    // so no single root index.json is rebuilt here
    if (this.templateLoader) {
      // loadAllLocales is already called in TemplateLoaderService's onModuleInit
      const stats = this.templateLoader.getCacheStats();
      this.logger.log(
        `模板库加载完成: ${stats.count} 个模板, ${stats.industries.length} 个行业, ${stats.deviceTypes.length} 种设备类型`,
      );
    }
  }
}
