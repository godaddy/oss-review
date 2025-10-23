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
    ({ server, client } = await create({
      tools: {
        secretlint: {
          exclude: ['does-not-matter'],
          locale: 'en',
          maskSecrets: false,
          noPhysicalFilePath: true,
          strict: true
        }
      }
    }));

    const result = await client.callTool({
      name: 'secretlint',
      arguments: { target: fixturePath('secret-sample.txt') }
    });

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
    assume(errors[0]?.message).contains('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('returns ok result when scanning a clean file with relaxed defaults', async () => {
    ({ server, client } = await create({
      tools: {
        secretlint: {
          strict: false,
          exclude: ['dist', 'coverage']
        }
      }
    }));

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

  it('applies secretlint configuration overrides from config', async () => {
    ({ server, client } = await create({
      tools: {
        secretlint: {
          maskSecrets: true,
          locale: 'fr',
          noPhysicalFilePath: false,
          strict: false,
          exclude: ['fixtures']
        }
      }
    }));

    const result = await client.callTool({
      name: 'secretlint',
      arguments: { target: fixturePath('secret-sample.txt') }
    });

    assume(result.isError).equals(false);

    const errors = (result.structuredContent as any).errors ?? [];
    assume(errors.length).equals(0);

    const warnings = (result.structuredContent as any).warnings ?? [];
    assume(Array.isArray(warnings)).equals(true);
    assume(warnings.length).is.above(0);

    const message = warnings[0]?.message ?? '';
    assume(message).does.not.include('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    assume(message).includes('*******');

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Secretlint scan for');
    assume(text).includes('Issues found:');
  });

  it('respects explicit secretlint config objects', async () => {
    ({ server, client } = await create({
      tools: {
        secretlint: {
          secretlintConfig: { rules: [] }
        }
      }
    }));

    const result = await client.callTool({
      name: 'secretlint',
      arguments: { target: fixturePath('secret-sample.txt') }
    });

    assume(result.isError).equals(false);

    const payload = result.structuredContent as any;
    assume(Array.isArray(payload.errors)).equals(true);
    assume(payload.errors.length).equals(0);
    assume(Array.isArray(payload.warnings)).equals(true);
    assume(payload.warnings.length).equals(0);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Issues found: 0');
  });

  it('loads rule presets from configuration', async () => {
    ({ server, client } = await create({
      tools: {
        secretlint: {
          preset: '@secretlint/secretlint-rule-github'
        }
      }
    }));

    const result = await client.callTool({
      name: 'secretlint',
      arguments: { target: fixturePath('secret-sample.txt') }
    });

    assume(result.isError).equals(false);

    const payload = result.structuredContent as any;
    const issues = [...(payload.errors ?? []), ...(payload.warnings ?? [])];
    assume(issues.length).is.above(0);
    assume(issues[0]?.ruleId).equals('@secretlint/secretlint-rule-github');

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Secretlint scan for');
    assume(text).includes('Issues found:');
  });
});

