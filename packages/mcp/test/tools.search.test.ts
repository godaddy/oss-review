import { afterEach, describe, it } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '../index.ts';
import assume from 'assume';
import { create, destroy, fixturePath } from './create.ts';

describe('tools: search', () => {
  let server: Server | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    if (server && client) await destroy(server, client);
    server = null;
    client = null;
  });

  it('registers search tool', async () => {
    ({ server, client } = await create());

    const list = await client.listTools();
    const searchTool = list.tools.find((tool) => tool.name === 'search');

    assume(searchTool).is.truthy();
    assume(searchTool?.inputSchema).is.truthy();
    assume(searchTool?.description).includes('detection');
  });

  it('detects sensitive links when scanning a file', async () => {
    ({ server, client } = await create({
      detection: {
        'sensitive-links': [
          {
            id: 'internal-wiki-url',
            title: 'Internal wiki reference',
            match: 'https?://wiki\\.example\\.com',
            type: 'regex',
            severity: 'high',
            remediation: 'Replace internal wiki references with public documentation.'
          }
        ]
      }
    }));

    const result = await client.callTool({
      name: 'search',
      arguments: { target: fixturePath('internal-reference.txt') }
    });

    assume(result).is.truthy();
    assume(result.isError).equals(false);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Detection scan for');
    assume(text).includes('Issues found:');
    assume(text).includes('internal-reference.txt');

    assume(result.structuredContent).has.property('issues');
    const issues = (result.structuredContent as any).issues ?? [];
    assume(issues.length).is.above(0);

    const wikiIssue = issues.find((issue: any) => issue.patternId === 'internal-wiki-url');
    assume(wikiIssue).is.truthy();
    assume(wikiIssue?.severity).equals('high');
    assume(wikiIssue?.filePath).includes('internal-reference.txt');
    assume(wikiIssue?.line).is.above(0);
  });

  it('detects secrets using keyword patterns', async () => {
    ({ server, client } = await create({
      detection: {
        secrets: [
          {
            id: 'pem-key-block',
            title: 'PEM private key block',
            match: '-----BEGIN PRIVATE KEY-----',
            type: 'keyword',
            severity: 'critical',
            remediation: 'Remove private keys before committing and rotate credentials.'
          }
        ]
      }
    }));

    const result = await client.callTool({
      name: 'search',
      arguments: { target: fixturePath('internal-reference.txt') }
    });

    assume(result.isError).equals(false);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Detection scan for');
    assume(text).includes('Issues found:');

    const issues = (result.structuredContent as any).issues ?? [];
    assume(issues.length).is.above(0);

    const pemIssue = issues.find((issue: any) => issue.patternId === 'pem-key-block');
    assume(pemIssue).is.truthy();
    assume(pemIssue?.severity).equals('critical');
    assume(pemIssue?.remediation).includes('Remove private keys');
  });

  it('filters by specific detection bucket', async () => {
    ({ server, client } = await create({
      detection: {
        'sensitive-links': [
          {
            id: 'internal-wiki-url',
            title: 'Internal wiki reference',
            match: 'https?://wiki\\.example\\.com',
            type: 'regex',
            severity: 'high'
          }
        ],
        secrets: [
          {
            id: 'pem-key-block',
            title: 'PEM private key block',
            match: '-----BEGIN PRIVATE KEY-----',
            type: 'keyword',
            severity: 'critical'
          }
        ]
      }
    }));

    // Search only in sensitive-links bucket
    const result = await client.callTool({
      name: 'search',
      arguments: {
        target: fixturePath('internal-reference.txt'),
        bucket: 'sensitive-links'
      }
    });

    assume(result.isError).equals(false);

    const issues = (result.structuredContent as any).issues ?? [];
    assume(issues.length).is.above(0);

    // Should only find wiki URL, not PEM key
    const wikiIssue = issues.find((issue: any) => issue.patternId === 'internal-wiki-url');
    assume(wikiIssue).is.truthy();

    const pemIssue = issues.find((issue: any) => issue.patternId === 'pem-key-block');
    assume(pemIssue).is.falsy();
  });

  it('scans directories recursively', async () => {
    ({ server, client } = await create({
      detection: {
        secrets: [
          {
            id: 'github-token',
            title: 'GitHub token',
            match: 'ghp_[a-zA-Z0-9]{36,}',
            type: 'regex',
            severity: 'critical'
          }
        ]
      }
    }));

    const result = await client.callTool({
      name: 'search',
      arguments: { target: fixturePath('.') }
    });

    assume(result.isError).equals(false);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Scanned files:');

    const payload = result.structuredContent as any;
    assume(payload.scannedFiles).is.above(1);
  });

  it('returns ok=false when critical or high severity issues found', async () => {
    ({ server, client } = await create({
      detection: {
        secrets: [
          {
            id: 'pem-key-block',
            title: 'PEM private key block',
            match: '-----BEGIN PRIVATE KEY-----',
            type: 'keyword',
            severity: 'critical'
          }
        ]
      }
    }));

    const result = await client.callTool({
      name: 'search',
      arguments: { target: fixturePath('internal-reference.txt') }
    });

    assume(result.isError).equals(false);

    const payload = result.structuredContent as any;
    assume(payload.ok).equals(false);
    assume(payload.totalIssues).is.above(0);
  });

  it('returns message when no patterns are configured', async () => {
    ({ server, client } = await create({
      detection: {}
    }));

    const result = await client.callTool({
      name: 'search',
      arguments: { target: fixturePath('LICENSE') }
    });

    assume(result.isError).equals(false);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('No detection patterns configured');
  });

  it('returns error when target path does not exist', async () => {
    ({ server, client } = await create());

    const result = await client.callTool({
      name: 'search',
      arguments: { target: '/non/existent/path/file.txt' }
    });

    assume(result.isError).equals(true);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('Target not found');
  });

  it('returns error when bucket does not exist', async () => {
    ({ server, client } = await create({
      detection: {
        secrets: [
          {
            id: 'test-pattern',
            match: 'test',
            type: 'keyword'
          }
        ]
      }
    }));

    const result = await client.callTool({
      name: 'search',
      arguments: {
        target: fixturePath('LICENSE'),
        bucket: 'non-existent-bucket'
      }
    });

    assume(result.isError).equals(true);

    const text = result.content?.[0]?.text ?? '';
    assume(text).includes('No detection patterns found in bucket');
  });
});

