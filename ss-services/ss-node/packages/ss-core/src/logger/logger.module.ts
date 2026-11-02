// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, Global } from '@nestjs/common';
import { StructuredLogger } from './structured-logger.service';

/**
 * LoggerModule - global logging module
 *
 * StructuredLogger keeps context/redaction/sampling capabilities, but file output is uniformly
 * delegated to global Winston (main.ts creates DailyRotateFile transports via LoggerFactory).
 * No resolveLogFilePath / fileOutput config is needed here anymore.
 *
 * The file-log directory and rotation policy are centrally managed by LoggerFactory.getLogConfig():
 *   {LOG_DIR}/app/app-%DATE%.log        - app log
 *   {LOG_DIR}/error/error-%DATE%.log    - error log
 */
@Global()
@Module({
  providers: [
    {
      provide: StructuredLogger,
      useFactory: () =>
        new StructuredLogger({
          logLevel: (process.env.LOG_LEVEL as any) || 'log',
          jsonFormat: process.env.NODE_ENV === 'production',
        }),
    },
  ],
  exports: [StructuredLogger],
})
export class LoggerModule {}
