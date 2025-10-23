# `@oss-review/syft`

Typed wrapper around the [Syft](https://github.com/anchore/syft) CLI used to generate CycloneDX SBOMs inside the OSS Review toolkit.

## Requirements

- Syft CLI must be installed and available on `PATH` (`brew install syft`, `curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sudo sh`, etc).
- Node.js 18+ (package is published as an ES module).

## Installation

```bash
npm install @oss-review/syft
```

## Usage

```ts
import { SyftScanner } from '@oss-review/syft';

const scanner = new SyftScanner();

// Ensure Syft executable is available
if (!(await SyftScanner.available())) {
  throw new Error('Syft CLI is not installed. Install from https://github.com/anchore/syft');
}

// Generate SBOM
const result = await scanner.scanDirectory(process.cwd());
console.log(result.bom.components);
```

### Options

- `executable`: Override path/name of Syft binary (`new SyftScanner({ executable: '/usr/local/bin/syft' })`).
- `env`: Custom environment variables passed to spawned processes.
- `logger`: Optional function that receives human-readable command information.

### `SyftScanner.available(options?)`

Checks whether Syft can be executed. Returns `true` when the command exits with code 0.

### `SyftScanner.scanDirectory(target, options?)`

Runs `syft scan dir:target -o cyclonedx-json`. Returns parsed JSON output plus metadata about the executed command. `options.includeDev = true` adds development catalogers. `options.additionalArgs` appends raw CLI arguments.

## Tests

Integration tests expect Syft to be installed locally. Run with:

```bash
npm test -- packages/syft/test/syft.test.ts
```

The suite will skip if Syft is unavailable.
