#!/usr/bin/env node

import { mergeConfigs, resolveConfigs, type ResolverCLIOptions } from '../packages/resolver/index';
import packageInfo from '../package.json' with { type: 'json' };
import { mcp } from '../packages/mcp/index';
import { Command } from 'commander';

/**
 * Construct the oss-review CLI using Commander.
 *
 * @returns Configured Commander instance
 */
function createCLI(): Command {
  const program = new Command();

  program
    .name(packageInfo.name)
    .description('Start the OSS Review MCP server over stdio.')
    .version(packageInfo.version, '-v, --version', 'Display the current version')
    .option(
      '-c, --config <source...>',
      'Add configuration sources (local files or npm packages)'
    )
    .option(
      '--registry <url>',
      'npm registry URL for installing remote configuration packages'
    )
    .action(async (options: ResolverCLIOptions) => {
      const configs = options.config
        ? await resolveConfigs(options.config, { registry: options.registry })
        : undefined;

      const mergedConfig = configs && configs.length > 0 ? mergeConfigs(configs) : undefined;
      const server = mcp({ config: mergedConfig });
      await server.start();
    });

  return program;
}

/**
 * CLI entry point for launching the OSS Review MCP server.
 *
 * @param argv - Process argument vector
 */
async function main(argv: readonly string[] = process.argv): Promise<void> {
  const cli = createCLI();
  await cli.parseAsync([...argv]);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('oss-review')) {
  main(process.argv).catch(function fatal(error) {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
