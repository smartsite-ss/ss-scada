// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * device-commands.ts - device management commands
 *
 *   device list    - list all devices, with optional --project filter
 *   device get     - view device details
 *   device start   - start device collection
 *   device stop    - stop device collection
 *   device status  - view device status
 *   device test    - test device connection
 */

import { ApiError } from '../core/ApiClient';
import { runDeviceCreateWizard } from './device-create-wizard';
import type { CommandParser } from '../core/CommandParser';

/** Create the device-management subcommand group */
export function registerCommands(parser: CommandParser): void {
  const program = parser.getProgram();

  const device = program.command('device').description('Device management commands');

  // device create-wizard
  device
    .command('create-wizard')
    .description('Interactive device creation wizard')
    .action(async () => {
      try {
        const apiClient = parser.createApiClient();
        await runDeviceCreateWizard({ apiClient });
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // device list
  device
    .command('list')
    .description('List all devices')
    .option('-p, --project <projectId>', 'Filter by project ID')
    .action(async (options: { project?: string }) => {
      const apiClient = parser.createApiClient();
      try {
        if (options.project) {
          const result = await apiClient.get<unknown>(
            `/api/v1/projects/${options.project}/devices`,
          );
          printDeviceList(result);
        } else {
          // When no project is given, list all projects first, then query devices per project
          const projects = await apiClient.get<unknown>('/api/v1/projects');
          const projectList = extractList<{ id: string; name: string }>(projects);
          if (projectList.length === 0) {
            console.log('No projects found.');
            return;
          }
          const allDevices: Array<Record<string, unknown>> = [];
          for (const proj of projectList) {
            try {
              const devices = await apiClient.get<unknown>(`/api/v1/projects/${proj.id}/devices`);
              const list = extractList<Record<string, unknown>>(devices);
              for (const d of list) {
                d._projectName = proj.name;
              }
              allDevices.push(...list);
            } catch {
              // Ignore errors for a single project
            }
          }
          printDeviceList(allDevices);
        }
      } catch (err) {
        handleError('Failed to list devices', err);
      }
    });

  // device get
  device
    .command('get')
    .description('Get device details')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .requiredOption('--id <deviceId>', 'Device ID')
    .action(async (options: { project: string; id: string }) => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.get<unknown>(
          `/api/v1/projects/${options.project}/devices/${options.id}`,
        );
        console.log('\n--- Device Details ---');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError('Failed to get device', err);
      }
    });

  // device start
  device
    .command('start')
    .description('Start device data collection')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .requiredOption('--id <deviceId>', 'Device ID')
    .action(async (options: { project: string; id: string }) => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.post<unknown>(
          `/api/v1/projects/${options.project}/devices/${options.id}/start`,
        );
        console.log('Device started successfully.');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError('Failed to start device', err);
      }
    });

  // device stop
  device
    .command('stop')
    .description('Stop device data collection')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .requiredOption('--id <deviceId>', 'Device ID')
    .action(async (options: { project: string; id: string }) => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.post<unknown>(
          `/api/v1/projects/${options.project}/devices/${options.id}/stop`,
        );
        console.log('Device stopped successfully.');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError('Failed to stop device', err);
      }
    });

  // device status
  device
    .command('status')
    .description('Get device status')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .requiredOption('--id <deviceId>', 'Device ID')
    .action(async (options: { project: string; id: string }) => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.get<unknown>(
          `/api/v1/projects/${options.project}/devices/${options.id}/status`,
        );
        console.log('\n--- Device Status ---');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError('Failed to get device status', err);
      }
    });

  // device test
  device
    .command('test')
    .description('Test device connection')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .requiredOption('--id <deviceId>', 'Device ID')
    .action(async (options: { project: string; id: string }) => {
      const apiClient = parser.createApiClient();
      try {
        const result = await apiClient.post<unknown>(
          `/api/v1/projects/${options.project}/devices/${options.id}/test`,
        );
        console.log('\n--- Connection Test Result ---');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError('Failed to test device connection', err);
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

/** Format and print the device list */
function printDeviceList(data: unknown): void {
  const list = extractList<Record<string, unknown>>(data);
  if (list.length === 0) {
    console.log('No devices found.');
    return;
  }
  console.log(`\nTotal: ${list.length} device(s)\n`);
  const rows = list.map((d) => ({
    ID: d.id,
    Name: d.deviceName,
    Code: d.deviceCode,
    Driver: d.driver ?? d.driverType,
    Status: d.status ?? '-',
    Project: (d as Record<string, unknown>)._projectName ?? d.projectId ?? '-',
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
