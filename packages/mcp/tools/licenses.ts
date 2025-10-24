/**
 * MCP license audit tool that leverages the shared Syft integration to analyse
 * CycloneDX SBOMs and compare discovered licences against the active policy.
 */
import type { MCPTextResponse, ToolContext } from '../types.ts';
import { z } from 'zod';
import diagnostics from 'diagnostics';
import { resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import type { LicenseCategory, LicenseEntry } from '../../config/index.ts';
import SyftScanner, { analyzeBom, analyzeSbomFile } from '../../syft/index.ts';

const debug = diagnostics('oss-review:mcp:tool:licenses');

/**
 * Supported classification buckets used when mapping components to policy
 * outcomes.
 */
type Classification = 'green' | 'yellow' | 'red' | 'unknown' | 'unlicensed';

/**
 * Lookup structure used to resolve licence ids to configured policy categories.
 */
interface LicensePolicyIndex {
  entries: Map<string, { category: LicenseCategory; source: LicenseEntry }>;
}

/**
 * Per-component report emitted by the licence audit containing the resolved
 * classification and supporting metadata.
 */
interface ComponentReport {
  ref: string;
  name: string;
  version?: string;
  type?: string;
  purl?: string;
  licenses: string[];
  classification: Classification;
  matchedLicences: Array<{ license: string; category: LicenseCategory | 'unknown'; notes?: string }>;
}

/**
 * Aggregated audit result containing per-component reports and convenience
 * counters broken down per policy bucket.
 */
interface LicenseAnalysisResult {
  components: ComponentReport[];
  counts: {
    total: number;
    withLicenses: number;
    green: number;
    yellow: number;
    red: number;
    unknown: number;
    unlicensed: number;
  };
  red: ComponentReport[];
  yellow: ComponentReport[];
  unknown: ComponentReport[];
  unlicensed: ComponentReport[];
  failReasons: string[];
}

/**
 * Zod schema describing accepted tool arguments received via MCP tool calls.
 */
const INPUT_SCHEMA = z.object({
  target: z.string().min(1).describe('Absolute or relative path to the repository or package under review.'),
  sbomPath: z.string().min(1).optional().describe('Optional path to an existing CycloneDX SBOM (json).'),
  includeDev: z.boolean().optional().describe('Include development dependencies when generating SBOMs (default: false).'),
  failOnUnknown: z.boolean().optional().describe('Treat unknown or missing licenses as blocking issues (default: false).'),
  syftArgs: z.array(z.string()).optional().describe('Additional Syft CLI arguments to append when generating SBOMs.'),
  skipGeneration: z.boolean().optional().describe('Skip automatic SBOM generation and require sbomPath (default: false).')
});

/**
 * Normalise licence identifiers by trimming and upper-casing the value.
 */
function normalizeLicenseId(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Build a lookup map for policy entries keyed by both id and friendly name.
 */
function buildLicenseIndex(entries: Record<LicenseCategory, LicenseEntry[] | undefined>): LicensePolicyIndex {
  const map = new Map<string, { category: LicenseCategory; source: LicenseEntry }>();

  (['green', 'yellow', 'red'] as LicenseCategory[]).forEach((category) => {
    for (const entry of entries[category] ?? []) {
      if (!entry?.id) continue;
      map.set(normalizeLicenseId(entry.id), { category, source: entry });
      if (entry.name) map.set(normalizeLicenseId(entry.name), { category, source: entry });
    }
  });

  return { entries: map };
}

/**
 * Update aggregate counters for a single component report and capture failure
 * reasons when applicable.
 */
function updateCounts(result: LicenseAnalysisResult, component: ComponentReport, failReason?: string) {
  const { counts } = result;
  counts.total += 1;
  if (component.licenses.length) counts.withLicenses += 1;

  switch (component.classification) {
    case 'red':
      counts.red += 1;
      result.red.push(component);
      break;
    case 'yellow':
      counts.yellow += 1;
      result.yellow.push(component);
      break;
    case 'green':
      counts.green += 1;
      break;
    case 'unknown':
      counts.unknown += 1;
      result.unknown.push(component);
      break;
    case 'unlicensed':
      counts.unlicensed += 1;
      result.unlicensed.push(component);
      break;
    default:
      break;
  }

  if (failReason) result.failReasons.push(failReason);
}

/**
 * Combine raw SBOM analysis entries with licence policy configuration to produce
 * the final audit report.
 */
function analyzeWithPolicy(entries: ReturnType<typeof analyzeBom>['entries'], index: LicensePolicyIndex, options: { failOnUnknown: boolean }): LicenseAnalysisResult {
  const result: LicenseAnalysisResult = {
    components: [],
    counts: {
      total: 0,
      withLicenses: 0,
      green: 0,
      yellow: 0,
      red: 0,
      unknown: 0,
      unlicensed: 0
    },
    red: [],
    yellow: [],
    unknown: [],
    unlicensed: [],
    failReasons: []
  };

  for (const entry of entries) {
    const normalizedLicenses = entry.licenses.map(normalizeLicenseId);
    let classification: Classification = 'green';
    let failReason: string | undefined;
    let hasGreen = false;
    let hasUnknown = false;

    const matchedLicences: Array<{ license: string; category: LicenseCategory | 'unknown'; notes?: string }> = [];

    if (!normalizedLicenses.length) {
      classification = 'unlicensed';
      if (options.failOnUnknown) failReason = `${entry.key}: Missing license information.`;
    } else {
      for (const license of normalizedLicenses) {
        const lookup = index.entries.get(license);
        if (!lookup) {
          hasUnknown = true;
          matchedLicences.push({ license, category: 'unknown' });
          continue;
        }

        matchedLicences.push({
          license,
          category: lookup.category,
          notes: lookup.source.notes
        });

        if (lookup.category === 'red') {
          classification = 'red';
          failReason = `${entry.key}: Detected prohibited license.`;
          break;
        }

        if (lookup.category === 'yellow' && classification !== 'red') {
          classification = 'yellow';
          failReason = `${entry.key}: Detected conditionally approved license.`;
        }

        if (lookup.category === 'green') hasGreen = true;
      }

      if (classification === 'green' && !hasGreen) classification = hasUnknown ? 'unknown' : 'green';
      if (classification === 'unknown' && options.failOnUnknown) failReason = `${entry.key}: Encountered license not defined in policy.`;
    }

    const report: ComponentReport = {
      ref: entry.component.bomRef ?? entry.key,
      name: entry.component.name ?? entry.key,
      version: entry.component.version,
      type: entry.component.type,
      purl: entry.component.purl,
      licenses: entry.licenses,
      classification,
      matchedLicences
    };

    result.components.push(report);
    updateCounts(result, report, failReason);
  }

  return result;
}

/**
 * Safe fs.stat wrapper returning null when the path does not exist.
 */
async function statSafe(path: string) {
  try {
    return await fs.stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Read and parse a CycloneDX SBOM from disk.
 */
async function readJsonFile(path: string) {
  const text = await fs.readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse SBOM at ${path}: ${(error as Error).message}`);
  }
}

/**
 * Load or generate an SBOM using Syft based on provided arguments.
 */
async function loadSbom(root: string, options: { sbomPath?: string; includeDev: boolean; skipGeneration: boolean; syftArgs?: string[] }, syft: SyftScanner) {
  if (options.sbomPath) {
    const resolved = resolve(options.sbomPath);
    const stats = await statSafe(resolved);
    if (!stats || !stats.isFile()) throw new Error(`SBOM file not found: ${resolved}`);

    const warnings = await syft.collectHints(root);
    const bom = await readJsonFile(resolved);
    return {
      bom,
      source: `Provided file: ${resolved}`,
      warnings,
      command: {
        executable: 'user-supplied',
        args: []
      }
    };
  }

  if (options.skipGeneration) {
    throw new Error('SBOM generation skipped and no sbomPath supplied.');
  }

  const warnings = await syft.collectHints(root);

  try {
    const result = await syft.scanDirectory(root, { additionalArgs: options.syftArgs });
    result.warnings.push(...warnings);
    return result;
  } catch (error) {
    warnings.push((error as Error).message);
    throw new Error(`Unable to generate SBOM via syft. ${warnings.join(' ')}`);
  }
}

/**
 * Render the final audit report as a human-readable string.
 */
function formatReport(target: string, sbomSource: string, analysis: LicenseAnalysisResult, warnings: string[]): string {
  const lines: string[] = [];

  lines.push(`License audit for ${target}`);
  lines.push(`SBOM source: ${sbomSource}`);
  lines.push(`Components analysed: ${analysis.counts.total} (with licenses: ${analysis.counts.withLicenses})`);
  lines.push(`- Green: ${analysis.counts.green}`);
  lines.push(`- Yellow: ${analysis.counts.yellow}`);
  lines.push(`- Red: ${analysis.counts.red}`);
  lines.push(`- Unknown: ${analysis.counts.unknown}`);
  lines.push(`- Unlicensed: ${analysis.counts.unlicensed}`);

  const appendSection = (title: string, entries: ComponentReport[]) => {
    if (!entries.length) return;
    lines.push('\n' + title + ':');
    for (const entry of entries.slice(0, 20)) {
      const licenseSummary = entry.matchedLicences.map((match) => `${match.license} (${match.category})`).join(', ') || 'None';
      lines.push(`- [${entry.classification.toUpperCase()}] ${entry.name}${entry.version ? `@${entry.version}` : ''} — ${licenseSummary}`);

      // Include notes if any matched license has them
      for (const match of entry.matchedLicences) {
        if (match.notes) {
          lines.push(`  Note: ${match.notes}`);
        }
      }
    }
    if (entries.length > 20) lines.push(`- ...and ${entries.length - 20} more`);
  };

  appendSection('Prohibited licenses detected', analysis.red);
  appendSection('Conditionally approved licenses', analysis.yellow);
  appendSection('Unknown licenses (not in policy)', analysis.unknown);
  appendSection('Components without license data', analysis.unlicensed);

  if (warnings.length) {
    lines.push('\nWarnings:');
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

  if (analysis.failReasons.length) {
    lines.push('\nPolicy exceptions:');
    for (const reason of analysis.failReasons) lines.push(`- ${reason}`);
  }

  return lines.join('\n');
}

/**
 * Factory returning the MCP tool definition registered under `licenses`.
 */
export function licenses(context: ToolContext) {
  /**
   * Execute the licence audit tool.
   */
  async function exec(rawArgs: Record<string, unknown>): Promise<MCPTextResponse> {
    const parsed = INPUT_SCHEMA.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: parsed.error.message }]
      };
    }

    const args = parsed.data;
    const target = resolve(args.target);
    const stats = await statSafe(target);
    if (!stats) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Target not found: ${target}` }]
      };
    }

    const licensesByCategory: Record<LicenseCategory, LicenseEntry[]> = {
      green: context.config.getLicenses('green') ?? [],
      yellow: context.config.getLicenses('yellow') ?? [],
      red: context.config.getLicenses('red') ?? []
    };

    const licenseIndex = buildLicenseIndex(licensesByCategory);

    const syftScanner = new SyftScanner();
    if (!(await SyftScanner.available({ executable: syftScanner.getExecutable(), env: process.env }))) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Syft CLI is not available. Install Syft (https://github.com/anchore/syft) or set the executable via configuration.' }]
      };
    }

    let sbom;
    try {
      sbom = await loadSbom(target, {
        sbomPath: args.sbomPath,
        includeDev: args.includeDev ?? false,
        skipGeneration: args.skipGeneration ?? false,
        syftArgs: args.syftArgs
      }, syftScanner);
    } catch (error) {
      debug('failed to load SBOM', error);
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
      };
    }

    const bomAnalysis = args.sbomPath ? await analyzeSbomFile(args.sbomPath) : analyzeBom(sbom.bom);
    const analysis = analyzeWithPolicy(bomAnalysis.entries, licenseIndex, { failOnUnknown: args.failOnUnknown ?? false });

    const ok = analysis.counts.red === 0 && (! (args.failOnUnknown ?? false) || (analysis.counts.unknown === 0 && analysis.counts.unlicensed === 0));

    const text = formatReport(target, sbom.source, analysis, sbom.warnings);

    return {
      isError: false,
      content: [{ type: 'text', text }],
      structuredContent: {
        ok,
        counts: analysis.counts,
        components: analysis.components,
        sbom: {
          source: sbom.source,
          format: sbom.bom.bomFormat ?? 'CycloneDX'
        },
        warnings: sbom.warnings,
        failReasons: analysis.failReasons
      }
    };
  }

  return {
    exec,
    title: 'License Audit',
    description: 'Audit project and dependency licenses against policy using SBOM data.',
    inputSchema: {
      target: z.string().min(1).describe('Absolute path to project or repository root.'),
      sbomPath: z.string().optional().describe('Path to existing CycloneDX SBOM JSON.'),
      includeDev: z.boolean().optional().describe('Include development dependencies (default false).'),
      failOnUnknown: z.boolean().optional().describe('Treat unknown/missing licenses as failures.'),
      skipGeneration: z.boolean().optional().describe('Skip automatic SBOM generation.')
    }
  };
}


