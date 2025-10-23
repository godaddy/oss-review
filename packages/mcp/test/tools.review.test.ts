import { describe, it, beforeEach } from 'node:test';
import { equal, ok, match } from 'node:assert/strict';
import { review } from '../tools/review.ts';
import { Config } from '../../config/index.ts';
import { Server } from '../index.ts';

describe('tools/review', () => {
  let config: Config;
  let server: Server;

  beforeEach(() => {
    config = new Config({
      profile: {
        name: 'Test Organization',
        legalName: 'Test Organization Inc.',
        website: 'https://test.org',
        emailDomain: 'test.org',
        securityEmail: 'security@test.org'
      },
      licenses: {
        green: [
          { id: 'MIT', name: 'MIT License' },
          { id: 'Apache-2.0', name: 'Apache License 2.0' }
        ]
      }
    });
    server = new Server({ config });
  });

  it('should create a valid tool definition', () => {
    const tool = review({ server, config });

    equal(tool.title, 'OSS Readiness Review');
    ok(tool.description.length > 0);
    ok(tool.inputSchema);
    ok(typeof tool.exec === 'function');
  });

  it('should execute successfully with valid arguments', async () => {
    const tool = review({ server, config });
    const result = await tool.exec({
      repository: 'test-repo'
    });

    equal(result.isError, false);
    ok(result.content);
    ok(result.content.length > 0);
    equal(result.content[0].type, 'text');
    ok(result.content[0].text.length > 0);
  });

  it('should include focus area when provided', async () => {
    const tool = review({ server, config });
    const result = await tool.exec({
      repository: 'test-repo',
      focus: 'security vulnerabilities'
    });

    equal(result.isError, false);
    ok(result.content[0].text.includes('security vulnerabilities'));
  });

  it('should include organization name in output', async () => {
    const tool = review({ server, config });
    const result = await tool.exec({
      repository: 'test-repo'
    });

    equal(result.isError, false);
    ok(result.content[0].text.includes('Test Organization'));
  });

  it('should return error when repository is missing', async () => {
    const tool = review({ server, config });
    const result = await tool.exec({});

    equal(result.isError, true);
    // The error message should mention that repository is required
    ok(result.content[0].text.toLowerCase().includes('required') ||
       result.content[0].text.toLowerCase().includes('repository'));
  });

  it('should return error when repository is empty string', async () => {
    const tool = review({ server, config });
    const result = await tool.exec({
      repository: '   '
    });

    equal(result.isError, true);
    ok(result.content[0].text.includes('required'));
  });

  it('should include structured content in response', async () => {
    const tool = review({ server, config });
    const result = await tool.exec({
      repository: 'test-repo',
      focus: 'licensing'
    });

    equal(result.isError, false);
    ok(result.structuredContent);
    equal((result.structuredContent as any).repository, 'test-repo');
    equal((result.structuredContent as any).focus, 'licensing');
    ok((result.structuredContent as any).messages);
  });

  it('should include persona guidance in output', async () => {
    const tool = review({ server, config });
    const result = await tool.exec({
      repository: 'test-repo'
    });

    equal(result.isError, false);
    // Persona should mention the organization and role
    match(result.content[0].text, /OSS Readiness/i);
    match(result.content[0].text, /Test Organization/i);
  });

  it('should include review checklist in output', async () => {
    const tool = review({ server, config });
    const result = await tool.exec({
      repository: 'test-repo'
    });

    equal(result.isError, false);
    const text = result.content[0].text;

    // Should include key checklist items
    match(text, /documentation/i);
    match(text, /licensing/i);
    match(text, /security/i);
  });
});

