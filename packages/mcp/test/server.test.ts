import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcp, Server } from '../index.ts';
import Config from '../../config/index.ts';
import { describe, it, afterEach } from 'node:test';
import assume from 'assume';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

/**
 * Create a configuration instance pointing at the test fixtures directory.
 *
 * @returns Config populated with profile metadata and resource definitions
 */
function createConfig(): Config {
  return new Config({
    profile: { name: 'GoDaddy' },
    resources: [{ name: 'LICENSE', path: fixturePath('LICENSE') }]
  });
}

/**
 * Provision MCP server and client connected over in-memory transports.
 *
 * @returns Object containing the initialised server, client, and config instance
 */
async function create() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const config = createConfig();
  const server = mcp({ config });
  await server.start(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
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
async function destroy(server: Server, client: Client) {
  await client.close();
  await server.close();
}

describe('mcp server', function suite() {
  let server: Server | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    if (client && server) await destroy(server, client);
    server = null;
    client = null;
  });

  it('starts and accepts a client connection', async function run() {
    ({ server, client } = await create());
    assume(client).is.truthy();
  });

  describe('resources', () => {
    it('lists and reads configured resources with templating', async function run() {
      ({ server, client } = await create());

    const list = await client.listResources();
    assume(list.resources).has.length(1);
    assume(list.resources[0]).has.property('name', 'LICENSE');
    assume(list.resources[0]).has.property('title', 'LICENSE');

    const read = await client.readResource({ uri: list.resources[0]!.uri });
    const content = read.contents?.[0];
    assume(content?.text).includes(`Copyright ${new Date().getFullYear()} GoDaddy`);
    assume(content?.text).includes('Apache License, Version 2.0');
    });
  });
});
