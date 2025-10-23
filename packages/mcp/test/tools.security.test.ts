import { afterEach, describe, it } from 'node:test';
import assume from 'assume';
import { mkdtemp } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '../index.ts';
import { create, destroy, fixturePath } from './create.ts';
import { NpmAuditProvider } from '../../advisory/npm.ts';
import { ca } from 'zod/v4/locales';

describe('tools: security', () => {
  let server: Server | null = null;
  let client: Client | null = null;
  const originalRun = NpmAuditProvider.prototype.run;

  afterEach(async () => {
    if (server && client) await destroy(server, client);
    server = null;
    client = null;
    NpmAuditProvider.prototype.run = originalRun;
  });

  it('registers security tool', async () => {
    ({ server, client } = await create());

    const list = await client.listTools();
    const tool = list.tools.find((entry) => entry.name === 'security');

    assume(tool).is.truthy();
    assume(tool?.description).includes('vulnerabilities');
    assume(tool?.inputSchema).is.truthy();
  });

  it('executes security audit with advisory findings', async () => {
    ({ server, client } = await create());

    NpmAuditProvider.prototype.run = async () => ({
      findings: [{
        id: 'GHSA-test',
        packageName: 'left-pad',
        packageVersion: '1.3.0',
        severity: 'high',
        source: 'npm-audit'
      }],
      warnings: [],
      metadata: {
        id: 'npm-audit',
        title: 'npm Audit',
        command: { executable: 'npm', args: ['audit', '--json'] }
      }
    });

    const tempDir = await mkdtemp(join(tmpdir(), 'oss-review-security-'));
    await fs.writeFile(join(tempDir, 'package.json'), '{"name":"fixture","version":"1.0.0"}', 'utf8');

    const result = await client.callTool({
      name: 'security',
      arguments: {
        target: tempDir,
        scanners: ['npm-audit'],
        skipGeneration: true
      }
    });

    assume(result.isError).equals(true);
    const payload = result.structuredContent as any;
    assume(payload.failReasons.length).equals(1);
    assume(payload.counts.high).equals(1);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses provided sbom when supplied', async () => {
    ({ server, client } = await create());

    const tmpDir = await mkdtemp(join(tmpdir(), 'oss-review-security-sbom-'));
    const sbom = fixturePath('sample-sbom.json');

    try {
      const result = await client.callTool({
        name: 'security',
        arguments: {
          target: tmpDir,
          sbomPath: sbom,
          skipGeneration: true,
          scanners: [],
          failOnUnscanned: false
        }
      });

      assume(result.isError).equals(false);
      const payload = result.structuredContent as any;
      assume(payload.sbom).is.truthy();
      assume(payload.sbom.source).includes('Provided file');
    } catch {
      throw new Error('This should never happen.');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});


