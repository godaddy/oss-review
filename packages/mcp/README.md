# OSS Review MCP Package

Provides MCP server capabilities and tools for OSS review workflows.

## Usage

### Review Prompt vs Review Tool

The review functionality is available in two forms:

1. **As a Prompt (`/review`)**: Users can manually invoke the prompt with `/review` in their MCP client, providing an interactive review experience.

2. **As a Tool**: AI agents can programmatically call the `review` tool to execute reviews on behalf of users. This is useful when the AI needs to automatically gather review guidance based on user requests.

Both use the same underlying logic and produce the same comprehensive OSS readiness guidance.

## Tools

- `search`: Placeholder search implementation used during development.
- `secretlint`: Scan files or directories to detect potential secrets before release.
- `licenses`: Analyse SBOMs against configured license policy.
- `security`: Aggregate vulnerability advisories using configured scanners (e.g. npm audit).
- `review`: Execute a comprehensive OSS readiness review for a repository.

## Prompts

- `review`: Interactive prompt that provides OSS readiness guidance (can also be invoked as a tool).

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
