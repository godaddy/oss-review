# Resolver Package

This package implements the configuration resolver used by the CLI and MCP server.

## Responsibilities

- Accept `--config` inputs from the CLI (local file paths or npm package specifiers).
- Download remote packages into a shared store when needed.
- Load each candidate module and ensure it exports a `Config` instance.
- Expose utilities for consumers:
  - `resolveConfigs(inputs, options)` – returns the ordered list of `Config` instances.
  - `mergeConfigs(configs)` – performs a shallow, last-write-wins merge of multiple configs.

## Installation Store

Remote packages are installed into a user-level store located at `~/.oss-review`. Each specifier is rewritten to a deterministic alias to avoid clashes, and lockfiles in that directory determine the package manager (`pnpm`, `yarn`, `bun`, or `npm`). The resolver checks for existing installs before fetching and waits for the installed package to be visible on disk.

## npm Registry Support

The resolver accepts an optional `registry` value (declared on the CLI as `--registry <url>`). When set, all installations use the provided registry URL; otherwise the package manager default is used.

```ts
await resolveConfigs(['@oss-review/example-config'], { registry: 'https://registry.npmjs.org' });
```

## Config Merging Semantics

`mergeConfigs` performs a shallow merge in input order. Later configs overwrite earlier key/value pairs, and nested objects are replaced rather than deep-merged. This mirrors the expectations of the existing AIchemy tooling.

```ts
const merged = mergeConfigs([
  new Config({ feature: { enabled: true }, shared: 'base' }),
  new Config({ feature: { percentage: 50 }, shared: 'override' })
]);

// merged.feature === { percentage: 50 }
// merged.shared === 'override'
```

## File Overview

- `index.ts` – resolver implementation, package manager detection, installation, file loading, and merge helper.
- `test/fixtures/` – reusable fixture modules exercised by the test suite.
- `test/resolver.test.ts` – integration coverage for resolving from fixtures and failure scenarios.

## Usage

```ts
import { resolveConfigs, mergeConfigs } from 'oss-review/resolver';

const configs = await resolveConfigs([
  './local-config.mjs',
  '@oss-review/example-config'
]);

const config = mergeConfigs(configs);
```

The merged configuration can be passed to the MCP server constructor or to other packages that accept `Config` objects.

