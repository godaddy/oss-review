import { afterEach, describe, it } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '../index.ts';
import assume from 'assume';
import { create, destroy, fixturePath } from './create.ts';

describe('resources: entries', () => {
  let server: Server | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    if (server && client) await destroy(server, client);
    server = null;
    client = null;
  });

  it('lists and reads configured resources with templating', async () => {
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

  it('lists and reads multiple resources', async () => {
    ({ server, client } = await create({
      resources: [
        { name: 'LICENSE', path: fixturePath('LICENSE') },
        { name: 'SECURITY.md', path: fixturePath('SECURITY.md') }
      ]
    }));

    const list = await client.listResources();
    assume(list.resources.map((resource) => resource.name)).deep.equals(['LICENSE', 'SECURITY.md']);

    const license = await client.readResource({ uri: list.resources.find((r) => r.name === 'LICENSE')!.uri });
    assume(license.contents?.[0]?.text).includes('Apache License, Version 2.0');

    const security = await client.readResource({ uri: list.resources.find((r) => r.name === 'SECURITY.md')!.uri });
    assume(security.contents?.[0]?.text).includes('security@godaddy.com');
  });
});

