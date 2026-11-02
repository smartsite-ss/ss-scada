// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, LoggerService, LogLevel, Optional, Logger } from '@nestjs/common';
import { LogEntry, StructuredLoggerConfig, DEFAULT_LOGGER_CONFIG } from './logger.types';

export { LogEntry, StructuredLoggerConfig, DEFAULT_LOGGER_CONFIG };

/**
 * Structured logging service
 *
 * Keeps structured capabilities such as context management (setContext/withContext),
 * redaction (redactSensitiveData), and sampling (enableSampling), but output is uniformly
 * delegated to the NestJS Logger, with the global WinstonModule (DailyRotateFile transports
 * configured in main.ts) responsible for file writes.
 *
 * No longer maintains its own file streams / rotation logic -- file logs are managed by Winston,
 * avoiding the previous redundancy of StructuredLogger writing app.log while Winston wrote combined.log.
 */
@Injectable()
export class StructuredLogger implements LoggerService {
  private config: StructuredLoggerConfig = DEFAULT_LOGGER_CONFIG;

  // Current request context (using AsyncLocalStorage or similar)
  private contextStore = new Map<string, any>();

  // Delegate to the NestJS Logger (via global Winston -> console + file)
  private readonly nestLogger = new Logger('StructuredLogger');

  constructor(@Optional() config?: Partial<StructuredLoggerConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  setConfig(config: Partial<StructuredLoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setContext(key: string, value: any): void {
    this.contextStore.set(key, value);
  }

  getContext(key: string): any {
    return this.contextStore.get(key);
  }

  clearContext(): void {
    this.contextStore.clear();
  }

  debug(message: any, context?: string): void {
    this.processLog('debug', message, context);
  }

  verbose(message: any, context?: string): void {
    this.processLog('verbose', message, context);
  }

  log(message: any, context?: string): void {
    this.processLog('log', message, context);
  }

  warn(message: any, context?: string): void {
    this.processLog('warn', message, context);
  }

  error(message: any, trace?: string, context?: string): void {
    const error = message instanceof Error ? message : null;
    const errorMessage = error ? error.message : message;

    this.processLog('error', errorMessage, context, { error, trace });
  }

  withContext(context: string): StructuredLogger {
    const logger = new StructuredLogger(this.config);
    logger.setContext('context', context);
    return logger;
  }

  withMetadata(metadata: Record<string, any>): StructuredLogger {
    const logger = new StructuredLogger(this.config);
    logger.setContext('metadata', { ...this.getContext('metadata'), ...metadata });
    return logger;
  }

  startTimer(label: string): () => void {
    const startTime = Date.now();

    return () => {
      const durationMs = Date.now() - startTime;
      this.processLog('debug', `${label} completed`, undefined, { metadata: { durationMs } });
    };
  }

  private processLog(
    level: LogLevel,
    message: any,
    context?: string,
    options?: { error?: Error; trace?: string; metadata?: Record<string, any> },
  ): void {
    // Check the log level
    if (!this.shouldLog(level)) return;

    // Check the sampling rate
    if (this.config.enableSampling && Math.random() > this.config.samplingRate) return;

    let entry: LogEntry = {
      timestamp: this.config.includeTimestamp ? new Date().toISOString() : undefined,
      level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      context: this.config.includeContext ? context || this.getContext('context') : undefined,
      traceId: this.getContext('traceId'),
      requestId: this.getContext('requestId'),
      userId: this.getContext('userId'),
      deviceId: this.getContext('deviceId'),
      metadata: options?.metadata || this.getContext('metadata'),
    };

    // Handle error objects
    if (options?.error) {
      entry.error = {
        name: options.error.name,
        message: options.error.message,
        stack: options.error.stack,
      };
    }

    // Handle trace
    if (options?.trace) {
      entry.metadata = { ...entry.metadata, stackTrace: options.trace };
    }

    // Redact sensitive data
    if (this.config.redactSensitiveData) {
      entry = this.redactSensitiveFields(entry);
    }

    // Format the output
    const formattedMessage = this.formatLogEntry(entry);
    const ctx = entry.context || 'StructuredLogger';

    // Delegate to the NestJS Logger (via global Winston -> console + file, unified rotation and compression)
    switch (level) {
      case 'error':
        this.nestLogger.error(formattedMessage, options?.error?.stack, ctx);
        break;
      case 'warn':
        this.nestLogger.warn(formattedMessage, ctx);
        break;
      case 'log':
        this.nestLogger.log(formattedMessage, ctx);
        break;
      case 'verbose':
        this.nestLogger.verbose(formattedMessage, ctx);
        break;
      case 'debug':
        this.nestLogger.debug(formattedMessage, ctx);
        break;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    return messageLevelIndex >= currentLevelIndex;
  }

  private formatLogEntry(entry: LogEntry): string {
    if (this.config.jsonFormat) {
      return JSON.stringify(entry);
    } else {
      const parts = [];

      if (entry.timestamp) {
        parts.push(entry.timestamp);
      }

      parts.push(`[${entry.level.toUpperCase()}]`);

      if (entry.context) {
        parts.push(`[${entry.context}]`);
      }

      parts.push(entry.message);

      if (entry.traceId) {
        parts.push(`traceId=${entry.traceId}`);
      }

      if (entry.requestId) {
        parts.push(`requestId=${entry.requestId}`);
      }

      if (entry.durationMs !== undefined) {
        parts.push(`duration=${entry.durationMs}ms`);
      }

      if (entry.error) {
        parts.push(`Error: ${entry.error.message}`);
        if (entry.error.stack) {
          parts.push('\n' + entry.error.stack);
        }
      }

      if (entry.metadata && Object.keys(entry.metadata).length > 0) {
        parts.push(`Metadata: ${JSON.stringify(entry.metadata)}`);
      }

      return parts.join(' ');
    }
  }

  private redactSensitiveFields(entry: LogEntry): LogEntry {
    const redacted = { ...entry };

    // Redact sensitive fields in metadata
    if (redacted.metadata) {
      redacted.metadata = this.redactObject(redacted.metadata);
    }

    // Redact sensitive info in the message (if it is a JSON string)
    if (typeof redacted.message === 'string' && redacted.message.startsWith('{')) {
      try {
        const parsed = JSON.parse(redacted.message);
        redacted.message = JSON.stringify(this.redactObject(parsed));
      } catch {
        // Not JSON; keep as-is
      }
    }

    return redacted;
  }

  private redactObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }

    const redacted: any = {};

    for (const [key, value] of Object.entries(obj)) {
      if (
        this.config.sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))
      ) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        redacted[key] = this.redactObject(value);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  destroy(): void {
    this.contextStore.clear();
  }
}
