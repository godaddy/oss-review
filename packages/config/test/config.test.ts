import { describe, it } from 'node:test';
import assume from 'assume';
import Config from '../index.ts';

describe('Config license helpers', () => {
  it('returns licenses provided via constructor', () => {
    const config = new Config({
      licenses: {
        green: [{ id: 'MIT' }],
        yellow: [{ id: 'MPL-2.0' }],
        red: [{ id: 'Proprietary' }]
      }
    });

    assume(config.getLicenses('green')).deep.equals([{ id: 'MIT' }]);
    assume(config.getLicenses('yellow')).deep.equals([{ id: 'MPL-2.0' }]);
    assume(config.getLicenses('red')).deep.equals([{ id: 'Proprietary' }]);
  });

  it('adds a new license entry to the requested category', () => {
    const config = new Config();

    config.license('green', { id: 'Apache-2.0', name: 'Apache License 2.0' });

    assume(config.getLicenses('green')).deep.equals([{ id: 'Apache-2.0', name: 'Apache License 2.0' }]);
  });

  it('replaces existing entries when the identifier matches', () => {
    const config = new Config({
      licenses: { green: [{ id: 'BSD-3-Clause', name: 'Original' }] }
    });

    config.license('green', { id: 'BSD-3-Clause', name: 'Updated' });

    assume(config.getLicenses('green')).deep.equals([{ id: 'BSD-3-Clause', name: 'Updated' }]);
  });

  it('requires a non-empty identifier', () => {
    const config = new Config();

    assume(() => config.license('green', { id: '' })).throws('License entry requires a non-empty "id".');
  });
});

describe('Config resource helpers', () => {
  it('returns resources supplied via constructor', () => {
    const config = new Config({
      resources: [{ name: 'LICENSE', path: 'LICENSE' }]
    });

    assume(config.getResources()).deep.equals([{ name: 'LICENSE', path: 'LICENSE' }]);
  });

  it('adds a new resource when calling resource()', () => {
    const config = new Config();

    config.resource('CODE_OF_CONDUCT.md', 'docs/CODE_OF_CONDUCT.md');

    assume(config.getResources()).deep.equals([{ name: 'CODE_OF_CONDUCT.md', path: 'docs/CODE_OF_CONDUCT.md' }]);
  });

  it('replaces an existing resource by name', () => {
    const config = new Config({
      resources: [{ name: 'CONTRIBUTING.md', path: 'docs/CONTRIBUTING.base.md' }]
    });

    config.resource('CONTRIBUTING.md', 'CONTRIBUTING.md');

    assume(config.getResources()).deep.equals([{ name: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md' }]);
  });

  it('requires a non-empty name', () => {
    const config = new Config();

    assume(() => config.resource('', 'LICENSE')).throws('Resource entry requires a non-empty "name".');
  });

  it('requires a non-empty path', () => {
    const config = new Config();

    assume(() => config.resource('LICENSE', '')).throws('Resource entry requires a non-empty "path".');
  });
});

describe('Config company helpers', () => {
  it('returns company profile supplied via constructor', () => {
    const config = new Config({
      profile: {
        name: 'GoDaddy',
        website: 'https://www.godaddy.com'
      }
    });

    assume(config.getProfile()).deep.equals({
      name: 'GoDaddy',
      website: 'https://www.godaddy.com'
    });
    assume(config.getProfileValue('name')).equals('GoDaddy');
  });

  it('adds a company profile entry via company()', () => {
    const config = new Config();

    config.profileField('name', 'GoDaddy').profileField('securityEmail', 'security@godaddy.com');

    assume(config.getProfileValue('securityEmail')).equals('security@godaddy.com');
    assume(config.getProfile()).deep.equals({
      name: 'GoDaddy',
      securityEmail: 'security@godaddy.com'
    });
  });

  it('merges profile details via mergeProfile()', () => {
    const config = new Config();

    config.mergeProfile({ name: 'GoDaddy', website: 'https://www.godaddy.com' });
    config.mergeProfile({ legalName: 'GoDaddy Inc.' });

    assume(config.getProfile()).deep.equals({
      name: 'GoDaddy',
      website: 'https://www.godaddy.com',
      legalName: 'GoDaddy Inc.'
    });
  });

  it('requires a non-empty key', () => {
    const config = new Config();

    assume(() => config.profileField('', 'value')).throws('Company profile entry requires a non-empty "key".');
  });

  it('requires a non-empty value', () => {
    const config = new Config();

    assume(() => config.profileField('name', '')).throws('Company profile entry requires a non-empty "value".');
  });
});

describe('Config instruction helpers', () => {
  it('returns instructions supplied via constructor', () => {
    const config = new Config({
      instructions: [{ name: 'readiness', content: 'Review OSS readiness.' }]
    });

    assume(config.getInstructions()).deep.equals([{ name: 'readiness', content: 'Review OSS readiness.' }]);
  });

  it('adds a new instruction via instruction()', () => {
    const config = new Config();

    config.instruction('overview', 'Provide release overview.');

    assume(config.getInstructions()).deep.equals([{ name: 'overview', content: 'Provide release overview.' }]);
  });

  it('replaces an instruction with the same name', () => {
    const config = new Config({
      instructions: [{ name: 'overview', content: 'First pass.' }]
    });

    config.instruction('overview', 'Updated content.', 'Summary');

    assume(config.getInstructions()).deep.equals([{ name: 'overview', content: 'Updated content.', summary: 'Summary' }]);
  });

  it('returns a single instruction when name is provided', () => {
    const config = new Config({
      instructions: [{ name: 'overview', content: 'Provide release overview.' }]
    });

    assume(config.getInstructions('overview')).deep.equals({ name: 'overview', content: 'Provide release overview.' });
  });

  it('returns undefined when instruction name is missing', () => {
    const config = new Config({
      instructions: [{ name: 'overview', content: 'Provide release overview.' }]
    });

    assume(config.getInstructions('not-found')).is.undefined();
  });

  it('returns undefined when name is only whitespace', () => {
    const config = new Config({
      instructions: [{ name: 'overview', content: 'Provide release overview.' }]
    });

    assume(config.getInstructions('   ')).is.undefined();
  });

  it('requires a non-empty name', () => {
    const config = new Config();

    assume(() => config.instruction('', 'content')).throws('Instruction entry requires a non-empty "name".');
  });

  it('requires non-empty content', () => {
    const config = new Config();

    assume(() => config.instruction('overview', '')).throws('Instruction entry requires a non-empty "content".');
  });
});

describe('Config tool helpers', () => {
  it('returns tool configuration supplied via constructor', () => {
    const config = new Config({
      tools: {
        secretlint: { strict: false }
      }
    });

    assume(config.getTool('secretlint')).deep.equals({ strict: false });
  });

  it('adds tool configuration via tool()', () => {
    const config = new Config();

    config.tool('secretlint', { preset: 'custom' });

    assume(config.getTool('secretlint')).deep.equals({ preset: 'custom' });
  });

  it('replaces existing configuration for the same tool', () => {
    const config = new Config({
      tools: {
        secretlint: { strict: true }
      }
    });

    config.tool('secretlint', { strict: false, exclude: ['dist'] });

    assume(config.getTool('secretlint')).deep.equals({ strict: false, exclude: ['dist'] });
  });

  it('requires a non-empty tool name', () => {
    const config = new Config();

    assume(() => config.tool('', {})).throws('Tool entry requires a non-empty "name".');
  });
});

describe('Config detection helpers', () => {
  it('returns detection buckets supplied via constructor', () => {
    const config = new Config({
      detection: {
        secrets: [{ id: 'token', match: 'ghp_[a-zA-Z0-9]{36}', severity: 'high' }]
      }
    });

    assume(config.getDetection('secrets')).deep.equals([{ id: 'token', match: 'ghp_[a-zA-Z0-9]{36}', severity: 'high' }]);
  });

  it('adds detection patterns into buckets', () => {
    const config = new Config();

    config.detectionPattern('internal-urls', { id: 'internal-domain', match: '\\.(corp|internal)\\b' });

    assume(config.getDetection('internal-urls')).deep.equals([{
      id: 'internal-domain',
      match: '\\.(corp|internal)\\b',
      type: 'regex',
      severity: 'medium'
    }]);
  });

  it('replaces detection patterns with same id', () => {
    const config = new Config({
      detection: {
        names: [{ id: 'employee', match: '@godaddy\\.com', severity: 'medium' }]
      }
    });

    config.detectionPattern('names', { id: 'employee', match: '@corp\\.godaddy\\.com', severity: 'high' });

    assume(config.getDetection('names')).deep.equals([{
      id: 'employee',
      match: '@corp\\.godaddy\\.com',
      type: 'regex',
      severity: 'high'
    }]);
  });

  it('requires bucket name', () => {
    const config = new Config();

    assume(() => config.detectionPattern('', { id: 'test', match: 'foo' })).throws('Detection bucket requires a non-empty name.');
  });

  it('requires pattern id and match', () => {
    const config = new Config();

    assume(() => config.detectionPattern('bucket', { id: '', match: 'foo' })).throws('Detection pattern requires a non-empty "id".');
    assume(() => config.detectionPattern('bucket', { id: 'foo', match: '' })).throws('Detection pattern requires a non-empty "match" string.');
  });
});


