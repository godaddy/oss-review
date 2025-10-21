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

# via npx (no global install)
npx oss-review

# or directly from this repo after building
node ./dist/bin/cli.js
```

This starts the MCP server over stdio.

## Configure with an MCP client

Add the server to your MCP client configuration (examples below).

### Claude Desktop (example)
```json
{
  "mcpServers": {
    "oss-review": {
      "command": "oss-review"
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
