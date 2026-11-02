// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * data-commands.ts - data query commands
 *
 *   data query  - query time-series data
 *   data latest - query the latest value
 */

import { ApiError } from '../core/ApiClient';
import type { CommandParser } from '../core/CommandParser';

/** Create the data-query subcommand group */
export function registerCommands(parser: CommandParser): void {
  const program = parser.getProgram();

  const data = program.command('data').description('Data query commands');

  // data query
  data
    .command('query')
    .description('Query time-series data')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .requiredOption('-t, --tag <tagName>', 'Tag name to query')
    .requiredOption('--from <fromTime>', 'Start time (ISO 8601 or relative, e.g. -1h)')
    .requiredOption('--to <toTime>', 'End time (ISO 8601 or relative, e.g. now)')
    .action(async (options: { project: string; tag: string; from: string; to: string }) => {
      const apiClient = parser.createApiClient();
      try {
        const params = new URLSearchParams({
          tag: options.tag,
          from: options.from,
          to: options.to,
        });
        const result = await apiClient.get<unknown>(
          `/api/v1/projects/${options.project}/data/query?${params.toString()}`,
        );
        printDataPoints(result);
      } catch (err) {
        handleError('Failed to query data', err);
      }
    });

  // data latest
  data
    .command('latest')
    .description('Get latest tag values')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .requiredOption('-t, --tag <tagName>', 'Tag name to query')
    .action(async (options: { project: string; tag: string }) => {
      const apiClient = parser.createApiClient();
      try {
        const params = new URLSearchParams({ tag: options.tag });
        const result = await apiClient.get<unknown>(
          `/api/v1/projects/${options.project}/data/latest?${params.toString()}`,
        );
        console.log('\n--- Latest Value ---');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError('Failed to get latest value', err);
      }
    });
}

/** Extract the data-point list from the API response */
function extractDataPoints(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) {
    return response as Array<Record<string, unknown>>;
  }
  const obj = response as Record<string, unknown>;
  if (obj.data) {
    if (Array.isArray(obj.data)) {
      return obj.data as Array<Record<string, unknown>>;
    }
    const nested = (obj.data as Record<string, unknown>).data;
    if (Array.isArray(nested)) {
      return nested as Array<Record<string, unknown>>;
    }
  }
  return [];
}

/** Format and print the data points */
function printDataPoints(data: unknown): void {
  const points = extractDataPoints(data);
  if (points.length === 0) {
    console.log('No data points found.');
    return;
  }
  console.log(`\nTotal: ${points.length} data point(s)\n`);
  const rows = points.map((p) => ({
    Time: p.time ?? p.timestamp ?? p._time ?? '-',
    Tag: p.tag ?? p.tagName ?? '-',
    Value: p.value ?? '-',
    Quality: p.quality ?? '-',
  }));
  console.table(rows);
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
