import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ConfigInstance } from '../../config/index.ts';
import Config from '../../config/index.ts';
import type { Server } from '../index.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcp } from '../index.ts';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

export interface ConfigOptions {
  profile?: { name: string; securityEmail: string };
  resources?: { name: string; path: string }[];
  instructions?: { name: string; content: string }[];
  tools?: {
    secretlint?: SecretlintToolOptions | { [key: string]: unknown };
    security?: Record<string, unknown>;
  };
}

/**
 * Resolve a test fixture path relative to the MCP test directory.
 */
export function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

/**
 * Create a configuration instance pointing at the test fixtures directory.
 *
 * @param overrides - Optional configuration overrides
 * @returns Config populated with profile metadata and resource definitions
 */
function createConfig(overrides?: ConfigOptions): Config {
  const { tools: overrideTools, ...restOverrides } = overrides ?? {};

  return new Config({
    profile: { name: 'GoDaddy', securityEmail: 'security@godaddy.com' },
    resources: [
      { name: 'LICENSE', path: fixturePath('LICENSE') }
    ],
    tools: {
      secretlint: {
        strict: true,
        locale: 'en',
        maskSecrets: false,
        noPhysicalFilePath: true
      },
      security: {
        severityThreshold: 'high',
        includeDev: false,
        scanners: ['npm-audit']
      },
      ...overrideTools
    },
    ...restOverrides
  });
}

export interface CreateResult {
  server: Server;
  client: Client;
  config: ConfigInstance;
}

/**
 * Provision MCP server and client connected over in-memory transports.
 *
 * @param overrides - Optional configuration overrides
 * @returns Object containing the initialised server, client, and config instance
 */
export async function create(overrides?: ConfigOptions): Promise<CreateResult> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const config = createConfig(overrides);
  const server = mcp({ config });
  await server.start(serverTransport);

  const client = new MCPClient({ name: 'test-client', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
  await client.connect(clientTransport);

  return { server, client, config };
}

/**
 * Dispose the provided MCP server and client pair.
 *
 * @param server - MCP server to close
 * @param client - MCP client to close
 * @returns Promise that resolves once both server and client are closed
 */
export async function destroy(server: Server, client: Client): Promise<void> {
  await client.close();
  await server.close();
}

