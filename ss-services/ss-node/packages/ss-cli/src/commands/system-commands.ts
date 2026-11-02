// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * system-commands.ts - system management commands
 *
 *   system health - system health check
 *   system info   - system information
 */

import { ApiError } from '../core/ApiClient';
import type { CommandParser } from '../core/CommandParser';

/** Create the system-management subcommand group */
export function registerCommands(parser: CommandParser): void {
  const program = parser.getProgram();

  const system = program.command('system').description('System management commands');

  // system health
  system
    .command('health')
    .description('System health check')
    .action(async () => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.get<Record<string, unknown>>('/api/health');
        console.log('\n--- System Health ---');
        printHealthStatus(result);
      } catch (err) {
        handleError('Health check failed', err);
      }
    });

  // system info
  system
    .command('info')
    .description('System information')
    .action(async () => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.get<Record<string, unknown>>('/api/system/info');
        console.log('\n--- System Info ---');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError('Failed to get system info', err);
      }
    });
}

/** Format and print the health status */
function printHealthStatus(data: Record<string, unknown>): void {
  const status = (data.status as string) ?? 'unknown';
  const icon = status === 'ok' || status === 'healthy' ? '✓' : '✗';
  console.log(`  Status:     ${icon} ${status}`);

  if (data.uptime !== undefined) {
    console.log(`  Uptime:     ${formatUptime(data.uptime as number)}`);
  }
  if (data.version !== undefined) {
    console.log(`  Version:    ${data.version}`);
  }
  if (data.timestamp !== undefined) {
    console.log(`  Timestamp:  ${data.timestamp}`);
  }

  // Print sub-component status
  if (data.components) {
    const components = data.components as Record<string, unknown>;
    console.log('\n  Components:');
    for (const [name, comp] of Object.entries(components)) {
      const compStatus = (comp as Record<string, unknown>).status ?? 'unknown';
      const compIcon = compStatus === 'ok' || compStatus === 'healthy' ? '✓' : '✗';
      console.log(`    ${compIcon} ${name}: ${compStatus}`);
    }
  }
}

/** Format uptime (seconds -> human-readable string) */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Unified error handling */
function handleError(context: string, err: unknown): void {
  if (err instanceof ApiError) {
    console.error(`${context}: ${err.message}`);
    console.error(`  Status: ${err.statusCode}`);
    console.error(`  Response: ${err.responseBody}`);
  } else {
    console.error(`${context}: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exitCode = 1;
}
