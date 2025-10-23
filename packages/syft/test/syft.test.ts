import { before, describe, it } from 'node:test';
import assume from 'assume';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import SyftScanner, { analyzeBom, analyzeSbomFile } from '../index.ts';
import type { CycloneDxBom } from '../index.ts';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PROJECT_FIXTURE = join(FIXTURES_DIR, 'project');
const BOM_FIXTURE = join(FIXTURES_DIR, 'bom', 'simple.json');
const CLEAN_FIXTURE = join(FIXTURES_DIR, 'clean');

let syftAvailable = false;

before(async () => {
  syftAvailable = await SyftScanner.available();
});

describe('SyftScanner integration', () => {
  it('requires Syft to be installed', async () => {
    const available = await SyftScanner.available();
    assume(available).equals(true);
  });

  it('generates a CycloneDX BOM for the project fixture', async () => {
    assume(syftAvailable).equals(true, 'Syft CLI must be installed for integration tests');

    const scanner = new SyftScanner();
    const result = await scanner.scanDirectory(PROJECT_FIXTURE);

    assume(result.bom.bomFormat).equals('CycloneDX');
    assume(Array.isArray(result.command.args)).equals(true);
    assume(result.warnings.some((hint) => hint.includes('Node.js manifest'))).equals(true);
  });

  it('collects manifest hints when package manifests exist', async () => {
    const scanner = new SyftScanner();
    const hints = await scanner.collectHints(PROJECT_FIXTURE);
    assume(hints.length).is.above(0);
  });

  it('returns empty hints for clean directories', async () => {
    const scanner = new SyftScanner();
    const hints = await scanner.collectHints(CLEAN_FIXTURE);
    assume(hints.length).equals(0);
  });

  it('parses an existing BOM file', async () => {
    const scanner = new SyftScanner();
    const bom = await scanner.readSbom(BOM_FIXTURE);
    assume(bom.components?.[0]?.name).equals('example');
  });

  it('fails when scanning a missing directory', async () => {
    assume(syftAvailable).equals(true, 'Syft CLI must be installed for integration tests');
    const scanner = new SyftScanner();
    await assume(scanner.scanDirectory(join(PROJECT_FIXTURE, 'missing'))).rejects();
  });

  it('throws when SBOM cannot be parsed', async () => {
    const tempPath = join(FIXTURES_DIR, 'bom', 'invalid.json');
    await fs.writeFile(tempPath, 'not json', 'utf8');
    const scanner = new SyftScanner();
    await assume(scanner.readSbom(tempPath)).rejects('Failed to parse SBOM');
    await fs.rm(tempPath, { force: true });
  });

  it('analyzes a parsed BOM structure', async () => {
    const scanner = new SyftScanner();
    const bom = await scanner.readSbom(BOM_FIXTURE);
    const report = analyzeBom(bom as CycloneDxBom);

    assume(report.totalComponents).equals(1);
    const entry = report.entries.find((candidate) => candidate.key === 'example');
    assume(entry).is.truthy();
    assume(entry?.licenses).deep.equals(['MIT']);
  });

  it('analyzes a BOM directly from file path', async () => {
    const report = await analyzeSbomFile(BOM_FIXTURE);
    assume(report.totalComponents).equals(1);
    const entry = report.entries.find((candidate) => candidate.key === 'example');
    assume(entry).is.truthy();
    assume(entry?.licenses).deep.equals(['MIT']);
  });
});

