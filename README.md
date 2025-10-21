# oss-review

Model Context Protocol (MCP) server for OSS review workflows. Provides a minimal boilerplate server with a single tool (`search`) and an example resource (`entries`).

## Install

```bash
# global (recommended for CLI usage)
npm i -g oss-review

# or as a dev dependency
npm i -D oss-review
```

## Run

```bash
# if installed globally
oss-review

# pass multiple configuration sources
oss-review --config ./configs/base.mjs --config @oss-review/example-config

# via npx (no global install)
npx oss-review

# or directly from this repo after building
node ./dist/bin/cli.js

# include configuration inputs
node ./dist/bin/cli.js --config ./configs/base.mjs --config @oss-review/example-config
# override npm registry for remote packages
node ./dist/bin/cli.js --config @oss-review/example-config --registry https://registry.npmjs.org
```

This starts the MCP server over stdio. Optionally provide one or more `--config` inputs to load project-specific configuration from local files or published packages. When multiple configs are supplied, they are merged in order (last input wins on conflicts). Use `--registry <url>` to install remote packages from a specific npm registry; downloaded packages are stored under `~/.oss-review`.

## Configure with an MCP client

Add the server to your MCP client configuration (examples below).

### Claude Desktop (example)

```json
{
  "mcpServers": {
    "oss-review": {
      "command": "oss-review",
      "args": [
        "--config",
        "@my-package/oss-review"
      ]
    }
  }
}
```

### VS Code MCP clients (example)

```json
{
  "mcpServers": [
    { "name": "oss-review", "command": "oss-review" }
  ]
}
```

## Available capabilities

### Tools

- `search`
  - Description: Search things (boilerplate)
  - Input schema:
    - `query` (string, required)

Example tool input:

```json
{ "query": "button" }
```

### Resources

- `entries`
  - URI template: `{protocol}://{host}/{path}`
  - Example resource URI: `oss-review://v0/example`

## Development

```bash
npm install
npm run build
npm test
```

- CLI entry: `bin/cli.ts`
- Server: `packages/mcp/index.ts`
- Tool example: `packages/mcp/tools/search.ts`
- Resource example: `packages/mcp/resources/entries.ts`
