// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

/**
 * Knowledge base module — pure-file approach
 *
 * No TypeORM/database dependency; managed via the file system + manifest.json only.
 * Requires gray-matter (Markdown frontmatter parsing).
 */
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
