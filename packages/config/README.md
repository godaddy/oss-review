# `@oss-review/config`

Configuration utilities shared across the OSS Review toolkit. Teams consume the
`Config` class to codify their own OSS readiness rules, then publish the result
as a reusable package that can be loaded by the `@oss-review/mcp` server.

## Installation

```bash
npm install oss-review
```

The `Config` entry point is accessible via `oss-review/config` when installed as
a dependency, or via the local source path `packages/config` inside this
repository.

## License Policy API

Create an instance of `Config` and define licenses grouped by the three allowed
categories. When your policy is finalised, publish it (e.g. to npm or an
internal registry) so that the MCP server can consume it as part of the review
workflow.

- `green`: Approved licenses that require no additional review
- `yellow`: Conditionally approved licenses requiring additional review
- `red`: Licenses that are prohibited for release

```ts
import Config from 'oss-review/config';

const config = new Config({
  licenses: {
    green: [{ id: 'MIT' }]
  }
});

config.license('yellow', {
  id: 'MPL-2.0',
  notes: 'Requires notification of modifications.'
});

const approved = config.getLicenses('green');
```

### `new Config(options)`

Constructs a configuration instance. The `licenses` property in `options`
accepts an object containing optional `green`, `yellow`, and `red` arrays. Each
array holds entries shaped as:

```ts
interface LicenseEntry {
  id: string;        // SPDX identifier or descriptive name (required)
  name?: string;     // Optional display name
  notes?: string;    // Optional guidance or restrictions
  url?: string;      // Optional reference link
}
```

### `config.license(category, entry)`

Adds or updates a license in the specified `category`. If an entry with the same
`id` already exists in the category it is replaced; otherwise the entry is
appended. Returns the same `Config` instance to allow chaining.

### `config.getLicenses(category)`

Retrieves the list of entries currently stored in the category. The method
returns a shallow copy, so mutating the returned array does not modify the
original configuration.

## Resource API

Use resources to describe required repository documents (e.g. `LICENSE`,
`SECURITY.md`, `CODE_OF_CONDUCT.md`). Each resource captures the display name
and the path to the file within the repository.

```ts
const config = new Config();

config.resource('LICENSE', 'LICENSE');
config.resource('CODE_OF_CONDUCT.md', 'docs/CODE_OF_CONDUCT.md');

const docs = config.getResources();
```

### `config.resource(name, path)`

Adds or updates a resource entry. Resources are deduplicated by `name`; calling
`resource()` with the same `name` will replace the existing path.

### `config.getResources()`

Returns the list of configured resources. The returned array is a shallow copy
so callers can safely modify it without affecting the stored configuration.

### Templates (recommended)

Publish your document templates in your config package and register them as resources so the MCP `entries` endpoint can serve them to LLMs:

```ts
config.resource('LICENSE', require.resolve('@your-config/resources/templates/LICENSE'));
config.resource('SECURITY.md', require.resolve('@your-config/resources/templates/SECURITY.md'));
config.resource('CONTRIBUTING.md', require.resolve('@your-config/resources/templates/CONTRIBUTING.md'));
config.resource('CODE_OF_CONDUCT.md', require.resolve('@your-config/resources/templates/CODE_OF_CONDUCT.md'));
```

Templates can include placeholders used by the MCP server when rendering:
- `{{ year }}`
- `{{ profile.name }}`
- `{{ profile.securityEmail }}`

## Company Profile API

Capture company metadata that can be merged into templates (e.g. contact
information, official names, domains).

```ts
const config = new Config();

config.mergeProfile({
  name: 'GoDaddy',
  securityEmail: 'security@godaddy.com'
});

const profile = config.getProfile();
const name = config.getProfileValue('name');
```

### `config.profile(details)`

Merges the provided `details` object into the existing profile. Empty string
values are ignored.

### `config.profileField(key, value)`

Adds or updates a single profile entry. Both `key` and `value` must be non-empty
strings.

### `config.getProfile()` / `config.getProfileValue(key)`

`getProfile()` returns a shallow copy of all profile fields. Use
`getProfileValue(key)` to retrieve a specific value.

## Instruction API

Instructions allow teams to provide reusable LLM guidance (for example, how to
execute a holistic readiness review or a license audit). Instructions are keyed
by name and contain rich markdown content.

```ts
const config = new Config();

config.instruction(
  'oss-readiness',
  `You are reviewing the repository for open-source readiness...
  - Verify secrets are removed
  - Ensure required docs exist`
);

const instructions = config.getInstructions();
```

### `config.instruction(name, content, summary?)`

Adds or updates an instruction entry. The optional `summary` helps when listing
instructions in UIs.

### `config.getInstructions()`

Returns the list of configured instructions.

## Tool Configuration API

Store arbitrary configuration for MCP tools so that server integrations can pick up defaults from a central package.

```ts
const config = new Config();

config.tool('secretlint', {
  strict: true,
  preset: '@secretlint/secretlint-rule-preset-recommend',
  exclude: ['dist', 'coverage']
});

const secretlintConfig = config.getTool('secretlint');
```

### `config.tool(name, settings)`

Adds or replaces configuration for the given tool name. `name` must be a non-empty string, and `settings` can be any JSON-serialisable structure (object, array, primitives).

### `config.getTool(name)`

Retrieves the configuration stored for `name`, or `undefined` when no configuration exists.

## Detection API

Define detection buckets containing patterns that tooling should flag. Each
bucket groups related detection rules (e.g. `internal-urls`, `secrets`).

```ts
const config = new Config();

config.detection('internal-urls', {
  id: 'internal-domains',
  match: '\\.(corp|internal)\\b',
  severity: 'high',
  remediation: 'Remove or anonymize internal domains before release.'
});

const internalPatterns = config.getDetection('internal-urls');
```

### `config.detection(bucket, pattern)`

Adds or updates a detection pattern within the named bucket.

### `config.getDetection(bucket?)`

Returns either the full detection bucket map or the entries for a specific
bucket when `bucket` is provided.

## Publishing Guidance

To share your configuration across teams:

1. Export a factory or instance of `Config` from your package (e.g. `@your-scope/oss-config`).
2. Publish the package to npm or your internal registry.
3. Reference the package when launching the MCP server (`oss-review --config @your-scope/oss-config`) or from CI workflows.

This provides a single source of truth for OSS policies while allowing the MCP
server to execute automated checks using your published configuration.
