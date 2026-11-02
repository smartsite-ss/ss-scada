// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * project-commands.ts - project management commands
 *
 *   project list - list all projects
 *   project get  - view project details
 */

import { ApiError } from '../core/ApiClient';
import type { CommandParser } from '../core/CommandParser';

/** Create the project-management subcommand group */
export function registerCommands(parser: CommandParser): void {
  const program = parser.getProgram();

  const project = program.command('project').description('Project management commands');

  // project list
  project
    .command('list')
    .description('List all projects')
    .action(async () => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.get<unknown>('/api/v1/projects');
        printProjectList(result);
      } catch (err) {
        handleError('Failed to list projects', err);
      }
    });

  // project get
  project
    .command('get')
    .description('Get project details')
    .requiredOption('--id <projectId>', 'Project ID')
    .action(async (options: { id: string }) => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.get<unknown>(`/api/v1/projects/${options.id}`);
        console.log('\n--- Project Details ---');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError('Failed to get project', err);
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

/** Format and print the project list */
function printProjectList(data: unknown): void {
  const list = extractList<Record<string, unknown>>(data);
  if (list.length === 0) {
    console.log('No projects found.');
    return;
  }
  console.log(`\nTotal: ${list.length} project(s)\n`);
  const rows = list.map((p) => ({
    ID: p.id,
    Name: p.name,
    Description: typeof p.description === 'string' ? p.description.substring(0, 50) : '-',
    Status: p.status ?? '-',
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
