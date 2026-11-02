// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module } from '@nestjs/common';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';

/**
 * Gallery module — pure-file approach
 *
 * No TypeORM/database dependency; gallery image resources are managed via the file system only.
 */
@Module({
  controllers: [GalleryController],
  providers: [GalleryService],
  exports: [GalleryService],
})
export class GalleryModule {}
