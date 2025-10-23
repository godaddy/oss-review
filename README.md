# OSS Review MCP Server

A Model Context Protocol (MCP) server that helps organizations safely release internal code as open source. It scans repositories for secrets, license violations, security vulnerabilities, and sensitive internal references that shouldn't be public.

## What does it do?

This tool automates the tedious parts of preparing code for open source release. Before you can safely publish internal code, you need to check for leaked credentials, ensure license compatibility, scan for security vulnerabilities, and remove internal references like private URLs or employee emails. This MCP server provides AI assistants with the tools to perform these checks automatically.

The server exposes specialized tools through the Model Context Protocol, allowing AI assistants like Claude to orchestrate security scans, analyze software bill of materials (SBOMs), check license policies, and provide guidance on manual review areas that require human judgment.

## Installation

```bash
# Install globally for CLI usage
npm install -g oss-review

# Or add as a development dependency to your project
npm install --save-dev oss-review
```

## Getting Started

Start the MCP server and it will communicate with your AI assistant over standard input/output. The simplest way to use it is through an MCP-compatible client like Claude Desktop.

```bash
# Start with default configuration
oss-review

# Provide custom configuration
oss-review --config ./my-config.mjs

# Load configuration from a published npm package
oss-review --config @mycompany/oss-config

# With published config package, private registry
oss-review --config @mycompany/oss-config --registry https://my.registry.here

# Multiple configs (merged in order, last wins)
oss-review --config @mycompany/base --config ./overrides.mjs
```

When you provide multiple configurations, they merge together with later configurations taking precedence. This lets you establish organization-wide defaults while allowing teams to override specific settings.

### Connecting to Claude Desktop

Add the server to Claude Desktop's configuration file at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "oss-review": {
      "command": "oss-review",
      "args": ["--config", "@mycompany/oss-config"]
    }
  }
}
```

After restarting Claude Desktop, the assistant will have access to all the review tools and can help you prepare repositories for open source release.

### Running a Review

Once connected, ask Claude to review your repository:

```
Can you review /path/to/my-project for open source readiness?
```

Or use the review prompt directly:

```
/review repository=my-project focus="security and licensing"
```

The assistant will use the available tools to scan for issues, check licenses, find vulnerabilities, and provide guidance on areas requiring manual review.

## How It Works

The server provides five specialized tools that the AI assistant orchestrates based on your request:

### Pattern Detection (`search`)

This tool scans your codebase for sensitive patterns you've defined in your configuration. Unlike secret scanners that look for credentials, this finds internal references like private domain names, internal URLs, employee email addresses, and infrastructure identifiers that reveal your internal architecture.

You define detection patterns in your configuration using regular expressions or keywords, organized into buckets like "internal-references" or "employee-info". When the AI scans your code, it reports findings with their locations and severity levels.

### Secret Scanning (`secretlint`)

Integrates with Secretlint to find leaked credentials, API keys, tokens, and other secrets. The tool scans files and directories, treating warnings as errors by default to ensure nothing slips through. It catches hardcoded passwords, AWS keys, GitHub tokens, JWT tokens, and other credential patterns that would compromise security if published.

### License Auditing (`licenses`)

Analyzes your project's dependencies and checks their licenses against your organization's policy. You define which licenses are approved (green), conditionally approved (yellow), or forbidden (red). The tool can generate software bill of materials (SBOMs) automatically or use existing ones, then validates every dependency's license and reports violations.

This catches issues like accidentally including GPL-licensed code in proprietary projects or dependencies with unknown licenses that need legal review.

### Vulnerability Scanning (`security`)

Runs security audits on your dependencies using npm audit to find known vulnerabilities. You can set severity thresholds, ignore specific advisories, and get detailed reports about security issues that need fixing before release. The tool helps ensure you're not releasing code with critical vulnerabilities that attackers could exploit.

### Comprehensive Review (`review`)

This tool (or prompt) orchestrates all the others into a complete readiness review. It checks required documentation, runs automated scans, and provides guidance on manual review areas that tools can't fully automate—like assessing whether code contains proprietary business logic or requires export control review.

## Configuration

Organizations publish their policies as configuration packages. Here's what a configuration looks like:

```javascript
import Config from 'oss-review/config';

const config = new Config({
  // Organization information used in templates
  profile: {
    name: 'Acme Corporation',
    securityEmail: 'security@acme.com'
  },

  // License policy: define what's allowed
  licenses: {
    green: [
      { id: 'MIT' },
      { id: 'Apache-2.0' },
      { id: 'BSD-3-Clause' }
    ],
    yellow: [
      { id: 'MPL-2.0', notes: 'Requires legal review' }
    ],
    red: [
      { id: 'GPL-3.0', notes: 'Incompatible with proprietary code' }
    ]
  },

  // Detection patterns for internal references
  detection: {
    'internal-references': [
      {
        id: 'internal-domains',
        match: '\\.(corp|internal|local)\\b',
        severity: 'high',
        remediation: 'Remove internal domain references before release'
      },
      {
        id: 'private-ips',
        match: '\\b10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b',
        severity: 'high',
        remediation: 'Replace private IPs with environment variables'
      }
    ]
  }
});

// Register document templates
config.resource('LICENSE', './templates/LICENSE');
config.resource('SECURITY.md', './templates/SECURITY.md');
config.resource('CODE_OF_CONDUCT.md', './templates/CODE_OF_CONDUCT.md');

export default config;
```

You can publish this configuration as an npm package and share it across your organization. Teams reference it when starting the MCP server, ensuring everyone uses the same policies and detection patterns.

For complete configuration documentation, see [packages/config/README.md](packages/config/README.md).

## Document Templates

The server can provide document templates to the AI assistant. When reviewing code, if required files like LICENSE or SECURITY.md are missing, the assistant can fetch templates and create them automatically.

Templates support variable substitution using your organization's profile:

- `{{ year }}` becomes the current year
- `{{ profile.name }}` becomes your organization name
- `{{ profile.securityEmail }}` becomes your security contact

This ensures generated documentation is consistent and properly branded with your organization's information.

## What Gets Reviewed

When you run a review, the assistant checks both automated and manual concerns:

**Automated checks** that tools can verify completely:
- Required documentation exists (LICENSE, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md)
- No secrets or credentials in the code
- No internal references like private URLs or infrastructure details
- All dependency licenses comply with your policy
- No known security vulnerabilities above your threshold

**Manual review areas** where tools provide guidance but human judgment is required:
- Does the code contain proprietary business logic or competitive advantages?
- Are there complex algorithms that might have IP protection considerations?
- Does any cryptographic code require export control review?
- Are there novel algorithms that might warrant patent searches?
- Does the repository history need sanitization?
- Is there clear maintainer commitment, or is this a one-time code dump?
- Does releasing this code reveal architectural details competitors could exploit?
- Are contribution policies clear and welcoming?

The assistant provides specific guidance for each manual concern it identifies, helping you make informed decisions about what requires human review before release.

## Development

To work on the MCP server itself:

```bash
git clone https://github.com/your-org/oss-review.git
cd oss-review
npm install
npm run build
npm test
```

The codebase is organized into specialized packages under `packages/`:

- `config/` - Configuration utilities and API
- `mcp/` - MCP server implementation, tools, prompts, and resources
- `advisory/` - Vulnerability advisory handling
- `resolver/` - Configuration resolution and merging
- `syft/` - SBOM generation wrapper

The CLI entry point is `bin/cli.ts` and the MCP server starts in `packages/mcp/index.ts`.

## License

See LICENSE file for details.
