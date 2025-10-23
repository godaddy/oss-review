import diagnostics from 'diagnostics';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import type { MCPTextResponse, ToolContext } from '../types.ts';
import type { AdvisoryFinding, AdvisoryIgnoreRule } from '../../advisory/index.ts';
import {
  applyIgnoreRules,
  loadIgnoreRules,
  mergeIgnoreRules,
  meetsSeverityThreshold,
  summariseFindings
} from '../../advisory/index.ts';
import { NpmAuditProvider } from '../../advisory/npm.ts';
import SyftScanner, { analyzeBom, analyzeSbomFile } from '../../syft/index.ts';

const debug = diagnostics('oss-review:mcp:tool:security');

const INPUT_SCHEMA = z.object({
  target: z.string().min(1).describe('Absolute or relative path to the repository or package under review.'),
  sbomPath: z.string().optional().describe('Optional path to an existing CycloneDX SBOM (json).'),
  skipGeneration: z.boolean().optional().describe('Skip SBOM generation. Requires sbomPath when true.'),
  includeDev: z.boolean().optional().describe('Include development dependencies (default: false).'),
  severityThreshold: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional()
    .describe('Minimum severity that should trigger a failure (default: high).'),
  scanners: z.array(z.enum(['npm-audit'])).optional().describe('Scanner identifiers to execute (default: npm-audit).'),
  ignoreIds: z.array(z.string()).optional().describe('Advisory identifiers to ignore for this run.'),
  ignoreFile: z.string().optional().describe('Path to JSON ignore file containing advisory exceptions.'),
  cacheDir: z.string().optional().describe('Directory used for scanner caches when supported.'),
  failOnUnscanned: z.boolean().optional().describe('Fail when no scanner can process the target (default: false).')
});

const DEFAULT_THRESHOLD = 'high';

interface SecurityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  unknown: number;
  total: number;
}

interface SecurityStructuredContent {
  ok: boolean;
  counts: SecurityCounts;
  findings: AdvisoryFinding[];
  ignored: AdvisoryFinding[];
  warnings: string[];
  failReasons: string[];
  scanners: Array<{ id: string; title: string; version?: string; command?: { executable: string; args: string[] } }>;
  sbom?: { source: string; format: string };
}

/**
 * Safely read filesystem metadata, returning null when the path is missing.
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
 * Merge ignore configuration provided by configuration defaults and tool arguments.
 */
async function resolveIgnoreRules(options: {
  configIgnoreIds?: unknown;
  configIgnoreFile?: unknown;
  configIgnore?: unknown;
  runtimeIds?: string[];
  runtimeFile?: string;
}): Promise<AdvisoryIgnoreRule[]> {
  const inlineIds: string[] = [];
  const ignoreSets: AdvisoryIgnoreRule[][] = [];

  const { configIgnore } = options;
  if (configIgnore && typeof configIgnore === 'object') {
    const candidate = configIgnore as Record<string, unknown>;
    if (Array.isArray(candidate.ids)) {
      candidate.ids.forEach((entry) => {
        if (typeof entry === 'string' && entry.trim()) inlineIds.push(entry.trim());
      });
    }
    if (typeof candidate.file === 'string' && candidate.file.trim()) {
      const rules = await loadIgnoreRules(candidate.file.trim());
      ignoreSets.push(rules);
    }
  }

  const configIds = Array.isArray(options.configIgnoreIds) ? options.configIgnoreIds : [];
  configIds.forEach((entry) => {
    if (typeof entry === 'string' && entry.trim()) inlineIds.push(entry.trim());
  });

  const configFile = typeof options.configIgnoreFile === 'string' && options.configIgnoreFile.trim()
    ? options.configIgnoreFile.trim()
    : undefined;

  const runtimeFile = typeof options.runtimeFile === 'string' && options.runtimeFile.trim()
    ? options.runtimeFile.trim()
    : undefined;

  if (configFile) ignoreSets.push(await loadIgnoreRules(configFile));
  if (runtimeFile) ignoreSets.push(await loadIgnoreRules(runtimeFile));

  const runtimeIds = Array.isArray(options.runtimeIds) ? options.runtimeIds : [];
  runtimeIds.forEach((entry) => {
    if (typeof entry === 'string' && entry.trim()) inlineIds.push(entry.trim());
  });

  if (inlineIds.length) {
    ignoreSets.push(inlineIds.map((id) => ({ id })));
  }

  return mergeIgnoreRules(...ignoreSets);
}

/**
 * Format the security report summary for consumption by MCP clients.
 */
function formatReport(
  target: string,
  counts: SecurityCounts,
  findings: AdvisoryFinding[],
  ignored: AdvisoryFinding[],
  warnings: string[],
  failReasons: string[]
): string {
  const lines: string[] = [];
  lines.push(`Security audit for ${target}`);
  lines.push(`Findings: ${counts.total}`);
  lines.push(`- Critical: ${counts.critical}`);
  lines.push(`- High: ${counts.high}`);
  lines.push(`- Medium: ${counts.medium}`);
  lines.push(`- Low: ${counts.low}`);
  lines.push(`- Info: ${counts.info}`);
  lines.push(`- Unknown: ${counts.unknown}`);

  const appendSection = (title: string, entries: AdvisoryFinding[]) => {
    if (!entries.length) return;
    lines.push('\n' + title + ':');
    for (const entry of entries.slice(0, 20)) {
      const fix = entry.fixedVersion ? ` (fixed in ${entry.fixedVersion})` : '';
      const version = entry.packageVersion ? `@${entry.packageVersion}` : '';
      lines.push(`- [${entry.severity.toUpperCase()}] ${entry.packageName}${version} ${entry.id}${fix}`);
    }
    if (entries.length > 20) lines.push(`- ...and ${entries.length - 20} more`);
  };

  appendSection('Blocking findings', findings.filter((item) => item.severity === 'critical' || item.severity === 'high'));
  appendSection('Ignored advisories', ignored);

  if (warnings.length) {
    lines.push('\nWarnings:');
    warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  if (failReasons.length) {
    lines.push('\nPolicy exceptions:');
    failReasons.forEach((reason) => lines.push(`- ${reason}`));
  }

  return lines.join('\n');
}

/**
 * Factory registering the security MCP tool.
 */
export function security(context: ToolContext) {
  const configDefaults = context.config.getTool('security');
  const defaults = typeof configDefaults === 'object' && configDefaults !== null
    ? { ...(configDefaults as Record<string, unknown>) }
    : {};

  async function exec(rawArgs: Record<string, unknown>): Promise<MCPTextResponse> {
    const input = INPUT_SCHEMA.safeParse(rawArgs);
    if (!input.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: input.error.message }]
      };
    }

    const args = { ...defaults, ...input.data } as z.infer<typeof INPUT_SCHEMA> & Record<string, unknown>;

    const target = resolve(String(args.target));
    const stats = await statSafe(target);
    if (!stats) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Target not found: ${target}` }]
      };
    }

    const severityThreshold = (args.severityThreshold ?? defaults.severityThreshold ?? DEFAULT_THRESHOLD) as 'critical' | 'high' | 'medium' | 'low' | 'info';
    const includeDev = Boolean(args.includeDev ?? defaults.includeDev ?? false);
    const scanners = Array.isArray(args.scanners)
      ? args.scanners
      : Array.isArray(defaults.scanners)
        ? (defaults.scanners as string[])
        : ['npm-audit'];

    const ignoreRules = await resolveIgnoreRules({
      configIgnore: defaults.ignore,
      configIgnoreIds: defaults.ignoreIds,
      configIgnoreFile: defaults.ignoreFile,
      runtimeIds: args.ignoreIds,
      runtimeFile: args.ignoreFile
    });

    const failOnUnscanned = Boolean(args.failOnUnscanned ?? defaults.failOnUnscanned ?? false);

    let sbom: { bom: unknown; source: string; warnings: string[]; command: { executable: string; args: string[] } } | undefined;
    let sbomAnalysis;

    if (args.sbomPath) {
      const resolvedSbom = resolve(args.sbomPath);
      try {
        const scanner = new SyftScanner();
        const bom = await scanner.readSbom(resolvedSbom);
        sbom = {
          bom,
          source: `Provided file: ${resolvedSbom}`,
          warnings: [],
          command: { executable: 'user-supplied', args: [] }
        };
        sbomAnalysis = analyzeBom(bom);
      } catch (error) {
        debug('failed to read provided SBOM', error);
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    } else if (!args.skipGeneration) {
      const syft = new SyftScanner();
      if (!(await SyftScanner.available({ executable: syft.getExecutable(), env: process.env }))) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Syft CLI is not available. Install Syft (https://github.com/anchore/syft).' }]
        };
      }

      try {
        const result = await syft.scanDirectory(target, { includeDev });
        sbom = result;
        sbomAnalysis = analyzeBom(result.bom);
      } catch (error) {
        debug('failed to generate SBOM', error);
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }

    const findings: AdvisoryFinding[] = [];
    const scannerMetadata: SecurityStructuredContent['scanners'] = [];
    const warnings: string[] = [];

    if (Array.isArray(scanners) && scanners.includes('npm-audit')) {
      try {
        const provider = new NpmAuditProvider();
        const result = await provider.run({
          target,
          includeDev,
          cacheDir: typeof args.cacheDir === 'string' ? args.cacheDir : undefined,
          sbom: sbomAnalysis
        });
        findings.push(...result.findings);
        scannerMetadata.push(result.metadata);
        warnings.push(...result.warnings);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!findings.length && failOnUnscanned) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'No scanners produced results. Verify tooling configuration or project manifests.' }]
      };
    }

    const { findings: filteredFindings, ignored, warnings: ignoreWarnings } = applyIgnoreRules(findings, ignoreRules);
    warnings.push(...ignoreWarnings);

    const counts = summariseFindings(filteredFindings) as SecurityCounts;
    const failReasons: string[] = [];

    filteredFindings.forEach((finding) => {
      if (meetsSeverityThreshold(finding.severity, severityThreshold)) {
        const version = finding.packageVersion ? `@${finding.packageVersion}` : '';
        failReasons.push(`${finding.packageName}${version} (${finding.id}) severity ${finding.severity} exceeds threshold ${severityThreshold}.`);
      }
    });

    const ok = failReasons.length === 0;
    const report = formatReport(target, counts, filteredFindings, ignored, warnings, failReasons);

    const structured: SecurityStructuredContent = {
      ok,
      counts,
      findings: filteredFindings,
      ignored,
      warnings,
      failReasons,
      scanners: scannerMetadata
    };

    if (sbom) {
      structured.sbom = {
        source: sbom.source,
        format: (sbom.bom as any)?.bomFormat ?? 'CycloneDX'
      };
    }

    return {
      isError: !ok,
      content: [{ type: 'text', text: report }],
      structuredContent: structured
    };
  }

  return {
    exec,
    title: 'Security Audit',
    description: 'Audit project dependencies for known vulnerabilities using advisory providers.',
    inputSchema: {
      target: z.string().min(1).describe('Absolute path to project or repository root.'),
      severityThreshold: z.string().optional().describe('Minimum severity threshold to treat as blocking.'),
      includeDev: z.boolean().optional().describe('Include development dependencies (default false).')
    }
  };
}


