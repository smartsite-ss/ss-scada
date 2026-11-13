#!/usr/bin/env node
// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Collector plugin scaffolding CLI
 *
 * Usage:
 *   pnpm create @ss-node/collector-plugin my-bacnet
 *   node bin/create-plugin.ts --name bacnet --display "BACnet/IP" --category building --transport tcp --author "SS-Team"
 *   npx ts-node bin/create-plugin.ts --name bacnet
 */

import { scaffoldPlugin } from '../src/scaffold';

function parseArgs(): {
  name: string;
  displayName: string;
  category: string;
  transport: string;
  author: string;
  outputDir?: string;
} {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {
    name: '',
    displayName: '',
    category: 'custom',
    transport: 'other',
    author: 'SS-Team',
  };

  // Positional argument: the first non -- argument is treated as name
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--name' || arg === '-n') {
      result.name = args[++i] || '';
    } else if (arg === '--display' || arg === '-d') {
      result.displayName = args[++i] || '';
    } else if (arg === '--category' || arg === '-c') {
      result.category = args[++i] || 'custom';
    } else if (arg === '--transport' || arg === '-t') {
      result.transport = args[++i] || 'other';
    } else if (arg === '--author' || arg === '-a') {
      result.author = args[++i] || 'SS-Team';
    } else if (arg === '--output' || arg === '-o') {
      result.outputDir = args[++i] || '';
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (!arg.startsWith('--') && !arg.startsWith('-') && !result.name) {
      result.name = arg;
    }
  }

  if (!result.name) {
    showHelp();
    process.exit(1);
  }

  return {
    name: result.name,
    displayName: result.displayName || result.name,
    category: result.category,
    transport: result.transport,
    author: result.author,
    outputDir: result.outputDir || undefined,
  };
}

function showHelp(): void {
  console.log(`
Usage: create-plugin [options] <plugin-name>

Options:
  --name, -n       Plugin name (e.g. "bacnet")
  --display, -d    Display name (e.g. "BACnet/IP")
  --category, -c   Protocol category (industrial_bus | iot | power | building | custom)
  --transport, -t  Transport type (tcp | serial | ws | tls | other)
  --author, -a     Author name
  --output, -o     Output directory (default packages/ss-collector/)
  --help, -h       Show help

Examples:
  pnpm create @ss-node/collector-plugin my-bacnet
  node bin/create-plugin.ts --name bacnet --display "BACnet/IP" --category building --transport tcp
  npx ts-node bin/create-plugin.ts bacnet -d "BACnet/IP" -c building -t tcp -a "SS-Team"
`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('');
  console.log('  🚀 Smart SCADA Collector Plugin Scaffold');
  console.log('  =========================================');
  console.log('');
  console.log(`  Plugin name:     ${options.name}`);
  console.log(`  Display name:    ${options.displayName}`);
  console.log(`  Category:        ${options.category}`);
  console.log(`  Transport:       ${options.transport}`);
  console.log(`  Author:          ${options.author}`);
  console.log('');

  try {
    const result = scaffoldPlugin(options);

    console.log(`  ✅ Plugin scaffold created successfully!`);
    console.log('');
    console.log(`  Directory: ${result.outputPath}`);
    console.log(`  Package:   ${result.packageName}`);
    console.log('');
    console.log(`  Generated files (${result.files.length}):`);
    for (const file of result.files) {
      console.log(`    - ${file}`);
    }
    console.log('');
    console.log('  Next steps:');
    console.log(`    1. cd ${result.outputPath}`);
    console.log('    2. pnpm install');
    console.log(`    3. Implement the TODO items in src/${options.name}.service.ts`);
    console.log('    4. pnpm run build');
    console.log('    5. pnpm test');
    console.log('');
  } catch (error) {
    console.error(`  ❌ Failed to create plugin: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
