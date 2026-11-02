// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import * as path from 'path';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/**
 * Unified logging config
 *
 * LoggerFactory centrally manages the creation of all Winston transports/loggers,
 * ensuring app, error, and plugin logs share consistent rotation and compression policies.
 *
 * Directory structure:
 *   {logDir}/app/app-%DATE%.log                - app log (all levels)
 *   {logDir}/error/error-%DATE%.log            - error log (error only)
 *   {logDir}/plugins/{protocol}/{protocol}-%DATE%.log - plugin collection logs
 *
 * Rotation policy: daily + by size (LOG_MAX_SIZE), historical files gzip-compressed (zippedArchive),
 * files beyond LOG_MAX_FILES are auto-deleted oldest-first.
 */
export interface LogConfig {
  /** Absolute path of the log root directory */
  logDir: string;
  /** Max size per file before rotation (e.g. '10m' / '100m') */
  maxSize: string;
  /** Keep the most recent N log files (including .gz, e.g. '14' / '14d') */
  maxFiles: string;
  /** Log level ('debug' | 'info' | 'warn' | 'error') */
  logLevel: string;
}

/**
 * Get the project-root absolute path
 *
 * Consistent with PathResolverService:
 * - Prefers SS_NODE_ROOT (set by main.ts / app.module.ts at startup)
 * - Falls back to process.cwd()
 */
function getProjectRoot(): string {
  if (process.env.SS_NODE_ROOT) {
    return path.normalize(process.env.SS_NODE_ROOT);
  }
  return path.normalize(process.cwd());
}

/**
 * Resolve a relative path to an absolute path (relative to the project root)
 * - Absolute paths returned as-is
 * - Relative paths resolved against the project root
 *
 * Same logic as PathResolverService.resolve(), ensuring LoggerFactory can
 * resolve paths correctly even in static-call scenarios (non-DI injection).
 */
function resolvePath(relativePath: string): string {
  const projectRoot = getProjectRoot();
  if (!relativePath) return projectRoot;
  if (path.isAbsolute(relativePath)) return path.normalize(relativePath);
  return path.resolve(projectRoot, relativePath);
}

/**
 * Read the unified logging config from environment variables
 *
 * Env vars:
 * - LOG_DIR: log root directory (relative paths resolved against the project root), default {projectRoot}/logs
 * - LOG_MAX_SIZE: max size per file (default '10m')
 * - LOG_MAX_FILES: number of files to keep (default '14')
 * - LOG_LEVEL: log level (default 'info')
 */
export function getLogConfig(): LogConfig {
  const logDir = process.env.LOG_DIR
    ? resolvePath(process.env.LOG_DIR)
    : path.join(getProjectRoot(), 'logs');

  return {
    logDir,
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: process.env.LOG_MAX_FILES || '14',
    logLevel: (process.env.LOG_LEVEL as string) || 'info',
  };
}

/**
 * Create the app-log transport (all levels: info+warn+error)
 *
 * File path: {logDir}/app/app-%DATE%.log
 * Daily rotation + size-based rotation, historical files gzip-compressed.
 */
export function createAppFileTransport(config: LogConfig): DailyRotateFile {
  return new DailyRotateFile({
    // Controlled by the LOG_LEVEL env var (default 'info')
    // Consistent with the Console transport, avoiding the file log still writing info level
    level: config.logLevel,
    filename: path.join(config.logDir, 'app', 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: config.maxSize,
    maxFiles: config.maxFiles,
    zippedArchive: true,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  });
}

/**
 * Create the error-log transport (error level only)
 *
 * File path: {logDir}/error/error-%DATE%.log
 * Daily rotation + size-based rotation, historical files gzip-compressed.
 */
export function createErrorFileTransport(config: LogConfig): DailyRotateFile {
  return new DailyRotateFile({
    level: 'error',
    filename: path.join(config.logDir, 'error', 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: config.maxSize,
    maxFiles: config.maxFiles,
    zippedArchive: true,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  });
}

/**
 * Create a plugin collection logger (per-protocol subdirectory, lazily created)
 *
 * File path: {logDir}/plugins/{protocol}/{protocol}-%DATE%.log
 * Daily rotation + size-based rotation, historical files gzip-compressed.
 *
 * Format: [timestamp] [LEVEL] message (compatible with the original PluginMonitorService format)
 *
 * @param config log config
 * @param protocol protocol name (e.g. 'modbus_tcp' / 'virtual')
 */
export function createPluginLogger(config: LogConfig, protocol: string): winston.Logger {
  return winston.createLogger({
    level: config.logLevel,
    transports: [
      new DailyRotateFile({
        filename: path.join(config.logDir, 'plugins', protocol, `${protocol}-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.maxSize,
        maxFiles: config.maxFiles,
        zippedArchive: true,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [${String(level).toUpperCase()}] ${message}`;
          }),
        ),
      }),
    ],
  });
}
