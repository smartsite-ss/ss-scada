// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * CommandParser - command parser
 *
 * Registers all CLI commands via commander, including:
 *   - init / start (basic commands)
 *   - device create-wizard (interactive device-creation wizard)
 *   - script create-wizard (interactive script-creation wizard)
 *
 * Global option: --interactive / -i enables interactive mode
 */

import { Command } from 'commander';
import { ApiClient } from './ApiClient';
import { runScriptCreateWizard } from '../commands/script-create-wizard';

export class CommandParser {
  private readonly program: Command;

  constructor() {
    this.program = new Command();
    this.setupGlobalOptions();
  }

  /** Get the commander Command instance (for external modules to register commands) */
  getProgram(): Command {
    return this.program;
  }

  /** Configure global options and metadata */
  private setupGlobalOptions(): void {
    this.program
      .name('ss-data')
      .description('Smart SCADA Node CLI Tool')
      .version('0.1.0')
      .option('-i, --interactive', 'Enable interactive mode');
  }

  /** Register all built-in commands */
  registerCommands(): void {
    this.registerInitCommand();
    this.registerStartCommand();
    this.registerScriptCommands();
  }

  /** init command */
  private registerInitCommand(): void {
    this.program
      .command('init')
      .description('Initialize a new project')
      .action(() => {
        console.log('Initializing ss-data project...');
      });
  }

  /** start command */
  private registerStartCommand(): void {
    this.program
      .command('start')
      .description('Start the server')
      .action(() => {
        console.log('Starting ss-data server...');
      });
  }

  /** script command group */
  private registerScriptCommands(): void {
    const script = this.program.command('script').description('Script management commands');

    script
      .command('create-wizard')
      .description('Interactive script creation wizard')
      .action(() => {
        this.runScriptWizard();
      });
  }

  /** Create an ApiClient (reads config from environment variables) */
  createApiClient(): ApiClient {
    const baseUrl = process.env.SS_CLI_SERVER_URL || 'http://localhost:4000';
    const apiKey = process.env.SS_CLI_API_KEY;
    const token = process.env.SS_CLI_TOKEN;

    return new ApiClient({ baseUrl, apiKey, token });
  }

  /** Run the script-creation wizard */
  private async runScriptWizard(): Promise<void> {
    try {
      const apiClient = this.createApiClient();
      await runScriptCreateWizard({ apiClient });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  /** Parse command-line arguments */
  parse(argv: string[]): void {
    this.program.parse(argv);
  }
}
