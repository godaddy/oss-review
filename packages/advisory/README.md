# `@oss-review/advisory`

Advisory aggregation utilities powering the OSS Review security tooling. The package normalises vulnerability findings from ecosystem-specific scanners (starting with `npm audit`) and provides helper utilities for ignore rules, severity thresholds, and SBOM-aware workflows.

## Installation

```bash
npm install @oss-review/advisory
```

## Usage

```ts
import { NpmAuditProvider, summariseFindings, applyIgnoreRules } from '@oss-review/advisory';

const provider = new NpmAuditProvider();
const result = await provider.run({
  target: process.cwd(),
  includeDev: false
});

const summary = summariseFindings(result.findings);
const filtered = applyIgnoreRules(result.findings, [{ id: 'GHSA-xxxx', packageName: 'left-pad' }]);

console.log(summary, filtered);
```

## Ignore Rules

Ignore files contain an array of entries:

```json
[
  {
    "id": "GHSA-xxxx",
    "packageName": "left-pad",
    "expiresAt": "2025-01-01T00:00:00Z",
    "reason": "Patched in private fork"
  }
]
```

Use `loadIgnoreRules()` to parse and `applyIgnoreRules()` to filter results. Expired entries generate warnings so they can be reviewed.

## Providers

The provider interface supports multiple advisory sources. The MVP ships with:

- `NpmAuditProvider`: wraps `npm audit --json` to collect vulnerabilities.

Future providers can map SBOM entries to advisory feeds such as GitHub Security Advisories or Sonatype.


