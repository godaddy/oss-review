import { afterEach, describe, it } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '../index.ts';
import assume from 'assume';
import { create, destroy, fixturePath } from './create.ts';

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

  it('detects secrets when scanning a file path', async () => {
    ({ server, client } = await create());

    const result = await client.callTool({
      name: 'secretlint',
      arguments: { target: fixturePath('secret-sample.txt') }
    });

    console.log(result);

    assume(result).is.truthy();
    assume(result.isError).equals(false);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Secretlint scan for');
    assume(text).includes('Issues found:');
    assume(text).includes('secret-sample.txt');
    assume(text.toLowerCase()).includes('secret');

    assume(result.structuredContent).has.property('errors');
    const errors = (result.structuredContent as any).errors ?? [];
    assume(errors.length).is.above(0);
    assume(errors[0]?.filePath).includes('secret-sample.txt');
  });

  it('returns ok result when scanning a clean file', async () => {
    ({ server, client } = await create());

    const result = await client.callTool({
      name: 'secretlint',
      arguments: { target: fixturePath('../../tools') }
    });

    assume(result.isError).equals(false);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Secretlint scan for');
    assume(text).includes('Scanned files:');
    assume(text).includes('Issues found: 0');

    assume(result.structuredContent).has.property('ok', true);
    const payload = result.structuredContent as any;
    assume(Array.isArray(payload.errors)).equals(true);
    assume(payload.errors.length).equals(0);
    assume(Array.isArray(payload.warnings)).equals(true);
    assume(payload.warnings.length).equals(0);
  });
});

