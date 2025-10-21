import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assume from 'assume';
import { rejects } from 'node:assert/strict';
import { resolveConfigs, mergeConfigs } from '../index.ts';
import Config from '../../config/index.ts';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

describe('config resolver', () => {
  it('resolves Config instances exported as default values', async () => {
    const [config] = await resolveConfigs([fixturePath('config-default.mjs')]);

    assume(config).is.instanceOf(Config);
    assume((config as Config).id).equals('default');
    assume((config as Config).source).equals('default-export');
  });

  it('resolves Config instances returned by factory functions', async () => {
    const [config] = await resolveConfigs([fixturePath('config-factory.mjs')]);

    assume(config).is.instanceOf(Config);
    assume((config as Config).id).equals('factory');
    assume((config as Config).source).equals('factory-export');
  });

  it('rejects when module does not expose a Config instance', async () => {
    await rejects(() => resolveConfigs([fixturePath('config-invalid.mjs')]));
  });

  it('rejects json files that do not contain Config instances', async () => {
    await rejects(() => resolveConfigs([fixturePath('invalid.json')]));
  });

  it('resolves multiple inputs preserving order', async () => {
    const configs = await resolveConfigs([
      fixturePath('config-default.mjs'),
      fixturePath('config-second.mjs')
    ]);

    assume(configs).is.length(2);
    assume(configs[0]).is.instanceOf(Config);
    assume((configs[0] as Config).id).equals('default');
    assume((configs[1] as Config).id).equals('second');
  });

  it('rejects npm specifiers that cannot be resolved', async () => {
    await rejects(() => resolveConfigs(['@oss-review/this-package-should-not-exist']));
  });
});

describe('mergeConfigs', () => {
  it('performs shallow merge with last writer winning conflicts', () => {
    const merged = mergeConfigs([
      new Config({ id: 'first', shared: 'first', keep: 'yes', nested: { a: 1 } }),
      new Config({ id: 'second', shared: 'second', nested: { b: 2 } })
    ]);

    assume(merged).is.instanceOf(Config);
    assume(merged.id).equals('second');
    assume(merged.shared).equals('second');
    assume(merged.keep).equals('yes');
    assume(merged.nested).deep.equals({ b: 2 });
  });

  it('returns empty Config when provided no inputs', () => {
    const merged = mergeConfigs([]);

    assume(merged).is.instanceOf(Config);
    assume(Object.keys(merged)).is.length(0);
  });
});
