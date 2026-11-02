// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * collector-commands.ts - collector management commands
 *
 *   collector status - view collector status
 */

import { ApiError } from '../core/ApiClient';
import type { CommandParser } from '../core/CommandParser';

/** Create the collector-management subcommand group */
export function registerCommands(parser: CommandParser): void {
  const program = parser.getProgram();

  const collector = program.command('collector').description('Collector management commands');

  // collector status
  collector
    .command('status')
    .description('Get collector status')
    .action(async () => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.get<unknown>('/api/v1/collector/status');
        printCollectorStatus(result);
      } catch (err) {
        handleError('Failed to get collector status', err);
      }
    });
}

/** Extract the list from the API response */
function extractList<T>(response: unknown): T[] {
  if (Array.isArray(response)) {
    return response as T[];
  }
  const obj = response as Record<string, unknown>;
  if (obj.data) {
    if (Array.isArray(obj.data)) {
      return obj.data as T[];
    }
    const nested = (obj.data as Record<string, unknown>).data;
    if (Array.isArray(nested)) {
      return nested as T[];
    }
  }
  return [];
}

/** Format and print the collector status */
function printCollectorStatus(data: unknown): void {
  console.log('\n--- Collector Status ---');

  const obj = data as Record<string, unknown>;
  const overallStatus = (obj.status as string) ?? 'unknown';
  const icon = overallStatus === 'running' || overallStatus === 'ok' ? '✓' : '✗';
  console.log(`  Overall Status: ${icon} ${overallStatus}`);

  if (obj.activeCount !== undefined) {
    console.log(`  Active Collectors: ${obj.activeCount}`);
  }
  if (obj.totalCount !== undefined) {
    console.log(`  Total Collectors:  ${obj.totalCount}`);
  }

  // Print details of each collector
  if (obj.collectors) {
    const collectors = extractList<Record<string, unknown>>(obj.collectors);
    if (collectors.length > 0) {
      console.log(`\n  Collectors (${collectors.length}):`);
      const rows = collectors.map((c) => ({
        Name: c.name ?? c.id ?? '-',
        Type: c.type ?? c.driver ?? '-',
        Status: c.status ?? '-',
        Uptime: c.uptime ?? '-',
        'Last Collect': c.lastCollect ?? c.lastCollectTime ?? '-',
      }));
      console.table(rows);
    }
  }
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
