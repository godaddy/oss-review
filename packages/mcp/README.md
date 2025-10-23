# OSS Review MCP Package

Provides MCP server capabilities and tools for OSS review workflows.

## Tools

- `search`: Placeholder search implementation used during development.
- `secretlint`: Scan files or directories to detect potential secrets before release.

## Resources

Resources are provided by your configuration package. Register them in your `Config` instance so the MCP server can list/read them via the `entries` resource:

```ts
config.resource('LICENSE', require.resolve('@your-config/resources/templates/LICENSE'));
config.resource('SECURITY.md', require.resolve('@your-config/resources/templates/SECURITY.md'));
config.resource('CONTRIBUTING.md', require.resolve('@your-config/resources/templates/CONTRIBUTING.md'));
config.resource('CODE_OF_CONDUCT.md', require.resolve('@your-config/resources/templates/CODE_OF_CONDUCT.md'));
```

Once configured, LLMs can:
- List resources
- Read a resource by URI: `oss-review://resources/{name}`

Prompts should: if a required file is missing in the repository (or each package in a monorepo), read the appropriate resource, render templates (profile, year), and create the file in the correct location.

