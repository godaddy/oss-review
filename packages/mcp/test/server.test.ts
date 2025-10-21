import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcp, Server } from '../index.ts';
import { describe, it } from 'node:test';
import assume from 'assume';

describe('mcp server', function suite() {
  it('starts and accepts a client connection', async function run() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = mcp();
    await server.start(serverTransport);

    const client = new Client({ name: 'test-agent', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
    await client.connect(clientTransport);

    assume(client).is.truthy();

    await client.close();
    await server.close();
  });
});


