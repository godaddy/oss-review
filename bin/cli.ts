#!/usr/bin/env node

import packageInfo from '../package.json' with { type: 'json' };
import { mcp } from '../packages/mcp/index';

/**
 * CLI entrypoint to start the OSS Review MCP server using stdio transport.
 */
async function main(): Promise<void> {
  const server = mcp();
  await server.start();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('oss-review')) {
  main().catch(function fatal(error) {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
