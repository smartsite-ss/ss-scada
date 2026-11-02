// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import * as path from 'path';
import * as fs from 'fs';
import { Controller, Get, Query, Res, UseGuards, Sse } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { LogViewerService, LogEntry, LogFilter } from './log-viewer.service';
import { JwtAuthGuard, RolesGuard, Roles, UserRole } from '@ss-node/ss-core';

@ApiTags('日志查看')
@Controller('system/logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class LogViewerController {
  constructor(private readonly logViewerService: LogViewerService) {}

  @Get()
  @ApiOperation({ summary: '查询日志' })
  @ApiQuery({ name: 'level', required: false })
  @ApiQuery({ name: 'module', required: false })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'lines', required: false })
  async getLogs(@Query() query: LogFilter) {
    return this.logViewerService.getRecentLogs(query, query.lines || 100);
  }

  @Sse('stream')
  @ApiOperation({ summary: 'SSE 实时日志推送' })
  streamLogs(@Query() query: LogFilter): Observable<LogEntry> {
    return this.logViewerService.subscribeToLogs(query);
  }

  @Get('files')
  @ApiOperation({ summary: '日志文件列表' })
  async getLogFiles() {
    return this.logViewerService.getLogFiles();
  }

  /**
   * Download a log file.
   *
   * The file name is passed via the `filename` query parameter (supports subdirectory paths,
   * e.g. `app/app-2026-07-29.log`), because under the new log directory layout files are spread across
   * the app/ error/ plugins/{protocol}/ subdirectories, and a single-segment `:filename` path parameter
   * cannot match paths containing `/`.
   *
   * Uses `@Res()` (without passthrough) + manual pipe to bypass the global TransformInterceptor's
   * response wrapping, avoiding StreamableFile being incorrectly JSON-serialized.
   */
  @Get('download')
  @ApiOperation({ summary: '下载日志文件' })
  @ApiQuery({ name: 'filename', required: true, description: '日志文件相对路径（含子目录）' })
  downloadLog(@Query('filename') filename: string, @Res() res: any): void {
    if (!filename) {
      res.status(400).json({ code: 400, message: 'filename is required' });
      return;
    }
    let filePath: string;
    try {
      filePath = this.logViewerService.getLogFilePath(filename);
    } catch (err) {
      const message = (err as Error).message || 'Invalid filename';
      const status = message.startsWith('Log file not found') ? 404 : 400;
      res.status(status).json({ code: status, message });
      return;
    }

    // The download file name takes only the basename, avoiding a path in Content-Disposition
    const downloadName = path.basename(filename);
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (!res.headersSent) {
        res.status(500).json({ code: 500, message: err.message });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  }
}
