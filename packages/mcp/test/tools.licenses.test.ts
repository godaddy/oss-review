import { afterEach, describe, it } from 'node:test';
import assume from 'assume';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '../index.ts';
import { create, destroy, fixturePath } from './create.ts';
import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import SyftScanner from '../../syft/index.ts';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const EXAMPLE_CONFIG = fileURLToPath(new URL('../../../example-config.mjs', import.meta.url));

async function loadExampleConfig() {
  const { default: config } = await import(EXAMPLE_CONFIG);
  return config;
}

describe('tools: licenses', () => {
  let server: Server | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    if (server && client) await destroy(server, client);
    server = null;
    client = null;
  });

  it('registers licenses tool', async () => {
    ({ server, client } = await create());

    const list = await client.listTools();
    const tool = list.tools.find((entry) => entry.name === 'licenses');

    assume(tool).is.truthy();
    assume(tool?.description).includes('license');
    assume(tool?.inputSchema).is.truthy();
  });

  it('audits provided SBOM and reports results', async () => {
    ({ server, client } = await create({
      licenses: {
        green: [{ id: 'MIT' }],
        red: [{ id: 'GPL-3.0' }]
      }
    }));

    const tmpDir = await mkdtemp(join(tmpdir(), 'oss-review-test-licenses-'));
    const originalAvailable = SyftScanner.available;
    SyftScanner.available = async () => true;

    try {
      const result = await client.callTool({
        name: 'licenses',
        arguments: {
          target: tmpDir,
          sbomPath: join(fixturePath('./'), 'sample-sbom.json'),
          failOnUnknown: true
        }
      });

      assume(result.isError).equals(false);
      const payload = result.structuredContent as any;
      assume(payload.ok).equals(true);
      assume(payload.counts.red).equals(0);
      assume(payload.counts.unknown).equals(0);
      assume(payload.counts.unlicensed).equals(0);

      const text = result.content?.[0]?.text ?? '';
      assume(text).includes('License audit for');
      assume(text).includes('Components analysed');
    } finally {
      SyftScanner.available = originalAvailable;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('audits the workspace root using example-config', async () => {
    const exampleConfig = await loadExampleConfig();
    ({ server, client } = await create({ ...exampleConfig }));

    const result = await client.callTool({
      name: 'licenses',
      arguments: {
        target: WORKSPACE_ROOT,
        failOnUnknown: true
      }
    });

    assume(result.isError).equals(false);
    const payload = result.structuredContent as any;

    assume(payload).is.truthy();
    assume(payload.ok).equals(false);
    assume(payload.counts.total).is.above(0);
    assume(payload.counts.unknown).is.above(0);
    assume(payload.failReasons.length).is.above(0);
  });
});


