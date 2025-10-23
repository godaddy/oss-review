import { afterEach, describe, it } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '../index.ts';
import assume from 'assume';
import { create, destroy } from './create.ts';

describe('tools: secretlint', () => {
  let server: Server | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    if (server && client) await destroy(server, client);
    server = null;
    client = null;
  });

  it('registers secretlint tool', async () => {
    ({ server, client } = await create());

    const list = await client.listTools();
    const secretlintTool = list.tools.find((tool) => tool.name === 'secretlint');

    assume(secretlintTool).is.truthy();
    assume(secretlintTool?.inputSchema).is.truthy();
    assume(secretlintTool?.description).includes('Secretlint');
  });
});

