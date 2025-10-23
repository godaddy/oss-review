import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import type { BomAnalysis } from '../syft/index.ts';

/**
 * Normalised severity buckets shared across advisory providers.
 */
export type AdvisorySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown';

/**
 * Mapping of severities to numeric weights used for ordering and threshold checks.
 */
const SEVERITY_WEIGHTS: Record<AdvisorySeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  unknown: 0
};

/**
 * Supported advisory ignore rule definition.
 */
export interface AdvisoryIgnoreRule {
  /** Identifier for the advisory (e.g. GHSA, CVE, SONATYPE). */
  id: string;
  /** Optional package name filter limiting the rule to a specific dependency. */
  packageName?: string;
  /** ISO timestamp denoting when the ignore entry expires. */
  expiresAt?: string;
  /** Optional human readable justification for the exception. */
  reason?: string;
}

/**
 * Representation of a normalised advisory contained in the analysis response.
 */
export interface AdvisoryFinding {
  /** Advisory identifier such as GHSA-XXXX, CVE-XXXX, or npm advisory id. */
  id: string;
  /** Name of the affected package. */
  packageName: string;
  /** Version string or range affected by the advisory. */
  packageVersion?: string;
  /** Unified severity classification. */
  severity: AdvisorySeverity;
  /** Optional textual description or title. */
  title?: string;
  /** Suggestions or remediation guidance provided by the advisory source. */
  recommendation?: string;
  /** Version containing the fix when known. */
  fixedVersion?: string;
  /** Optional external reference URL. */
  url?: string;
  /** Optional CWE identifiers when supplied by the advisory feed. */
  cwes?: string[];
  /** Underlying advisory provider identifier (e.g. npm-audit). */
  source: string;
  /** Additional metadata returned by the provider. */
  metadata?: Record<string, unknown>;
}

/**
 * Summary counts broken down by severity.
 */
export interface AdvisorySummary {
  /** Total number of findings. */
  total: number;
  /** Count of critical severity findings. */
  critical: number;
  /** Count of high severity findings. */
  high: number;
  /** Count of medium severity findings. */
  medium: number;
  /** Count of low severity findings. */
  low: number;
  /** Count of informational severity findings. */
  info: number;
  /** Count of findings with unknown severity. */
  unknown: number;
}

/**
 * Context supplied to advisory providers describing the environment they should scan.
 */
export interface AdvisoryProviderContext {
  /** Absolute path to the project root under analysis. */
  target: string;
  /** When true include development dependencies in the scan. */
  includeDev: boolean;
  /** Optional SBOM analysis generated upstream (CycloneDX). */
  sbom?: BomAnalysis;
  /** Directory used by providers for on-disk caches when supported. */
  cacheDir?: string;
  /** Optional environment variables forwarded to subprocess invocations. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Metadata describing an advisory provider.
 */
export interface AdvisoryProviderMetadata {
  /** Short identifier for the provider (e.g. npm-audit). */
  id: string;
  /** Human readable provider title. */
  title: string;
  /** Optional version string reported by the provider. */
  version?: string;
  /** Optional command invocation metadata when the provider shells out. */
  command?: {
    /** Executable invoked by the provider. */
    executable: string;
    /** Arguments passed to the executable. */
    args: string[];
  };
}

/**
 * Result returned by advisory providers.
 */
export interface AdvisoryProviderResult {
  /** Advisory findings reported by the provider. */
  findings: AdvisoryFinding[];
  /** Provider specific warnings or informational messages. */
  warnings: string[];
  /** Provider metadata describing the execution environment. */
  metadata: AdvisoryProviderMetadata;
}

/**
 * Definition that advisory scanners must implement.
 */
export interface AdvisoryProvider {
  /** Provider metadata. */
  readonly metadata: AdvisoryProviderMetadata;
  /**
   * Execute the advisory provider against the supplied context.
   *
   * @param context - Execution context describing the project under review.
   * @returns A promise resolving with the provider result payload.
   */
  run(context: AdvisoryProviderContext): Promise<AdvisoryProviderResult>;
}

/**
 * Result returned when applying ignore rules to a findings collection.
 */
export interface ApplyIgnoreResult {
  /** Findings that remain after applying ignore rules. */
  findings: AdvisoryFinding[];
  /** Findings filtered out by ignore rules. */
  ignored: AdvisoryFinding[];
  /** Warning messages emitted during ignore evaluation. */
  warnings: string[];
}

/**
 * Determine whether a severity meets or exceeds the supplied threshold.
 *
 * @param severity - Severity value to evaluate.
 * @param threshold - Minimum severity that should trigger a failure.
 * @returns True when the severity is greater than or equal to the threshold.
 */
export function meetsSeverityThreshold(severity: AdvisorySeverity, threshold: AdvisorySeverity): boolean {
  return SEVERITY_WEIGHTS[severity] >= SEVERITY_WEIGHTS[threshold];
}

/**
 * Summarise advisory findings into severity buckets.
 *
 * @param findings - Collection of normalised advisory findings.
 * @returns Aggregated severity counts.
 */
export function summariseFindings(findings: AdvisoryFinding[]): AdvisorySummary {
  const summary: AdvisorySummary = {
    total: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    unknown: 0
  };

  for (const finding of findings) {
    switch (finding.severity) {
      case 'critical':
        summary.critical += 1;
        break;
      case 'high':
        summary.high += 1;
        break;
      case 'medium':
        summary.medium += 1;
        break;
      case 'low':
        summary.low += 1;
        break;
      case 'info':
        summary.info += 1;
        break;
      default:
        summary.unknown += 1;
        break;
    }
  }

  return summary;
}

/**
 * Apply ignore rules to a collection of advisory findings.
 *
 * @param findings - Original findings to filter.
 * @param rules - Ignore rules sourced from configuration and tool arguments.
 * @returns Filtered findings with associated warnings and ignored entries.
 */
export function applyIgnoreRules(findings: AdvisoryFinding[], rules: AdvisoryIgnoreRule[]): ApplyIgnoreResult {
  if (!rules.length) {
    return { findings: [...findings], ignored: [], warnings: [] };
  }

  const ignored: AdvisoryFinding[] = [];
  const accepted: AdvisoryFinding[] = [];
  const warnings: string[] = [];

  const normalisedRules = rules.map((rule) => ({
    id: rule.id.trim(),
    packageName: rule.packageName?.trim(),
    expiresAt: rule.expiresAt?.trim(),
    reason: rule.reason?.trim()
  })).filter((rule) => Boolean(rule.id));

  for (const finding of findings) {
    const rule = normalisedRules.find((candidate) => {
      if (candidate.id.toUpperCase() !== finding.id.toUpperCase()) return false;
      if (!candidate.packageName) return true;
      return candidate.packageName.toLowerCase() === finding.packageName.toLowerCase();
    });

    if (!rule) {
      accepted.push(finding);
      continue;
    }

    if (rule.expiresAt) {
      const expiry = new Date(rule.expiresAt);
      if (Number.isFinite(expiry.getTime()) && expiry.getTime() < Date.now()) {
        warnings.push(`Ignore rule for ${finding.id} (${finding.packageName}) expired on ${expiry.toISOString()}.`);
        accepted.push(finding);
        continue;
      }
    }

    ignored.push(finding);
  }

  return { findings: accepted, ignored, warnings };
}

/**
 * Attempt to load advisory ignore rules from disk. The file must contain JSON describing
 * an array of ignore rule objects.
 *
 * @param filePath - Absolute or relative path to the ignore configuration file.
 * @returns Promise resolving with the parsed ignore rules (empty array when file missing).
 */
export async function loadIgnoreRules(filePath: string): Promise<AdvisoryIgnoreRule[]> {
  const resolved = resolve(filePath);

  try {
    const text = await fs.readFile(resolved, 'utf8');
    const data = JSON.parse(text);

    if (!Array.isArray(data)) return [];

    const rules: AdvisoryIgnoreRule[] = [];
    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (!id) continue;

      const rule: AdvisoryIgnoreRule = { id };
      if (typeof entry.packageName === 'string' && entry.packageName.trim()) rule.packageName = entry.packageName.trim();
      if (typeof entry.expiresAt === 'string' && entry.expiresAt.trim()) rule.expiresAt = entry.expiresAt.trim();
      if (typeof entry.reason === 'string' && entry.reason.trim()) rule.reason = entry.reason.trim();
      rules.push(rule);
    }

    return rules;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw new Error(`Failed to read advisory ignore file at ${resolved}: ${(error as Error).message}`);
  }
}

/**
 * Merge multiple ignore rule arrays, deduplicating entries by advisory id and package name.
 *
 * @param sets - Ignore rule arrays to merge.
 * @returns Combined array containing unique ignore rules.
 */
export function mergeIgnoreRules(...sets: AdvisoryIgnoreRule[][]): AdvisoryIgnoreRule[] {
  const map = new Map<string, AdvisoryIgnoreRule>();

  for (const list of sets) {
    for (const entry of list) {
      if (!entry?.id) continue;
      const key = `${entry.id.toUpperCase()}::${entry.packageName?.toLowerCase() ?? '*'}`;
      map.set(key, entry);
    }
  }

  return Array.from(map.values());
}

/**
 * Convert an arbitrary severity string to the normalised severity enumeration.
 * Unknown severities default to `unknown`.
 *
 * @param severity - Raw severity string supplied by advisory providers.
 * @returns Normalised advisory severity value.
 */
export function normaliseSeverity(severity: string | undefined | null): AdvisorySeverity {
  if (!severity) return 'unknown';
  const value = severity.toLowerCase();
  if (value in SEVERITY_WEIGHTS) return value as AdvisorySeverity;
  if (value === 'moderate') return 'medium';
  if (value === 'informational') return 'info';
  return 'unknown';
}

/**
 * Convenience helper for creating an empty advisory summary.
 *
 * @returns Summary object pre-populated with zero counts.
 */
export function createEmptySummary(): AdvisorySummary {
  return {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    unknown: 0
  };
}


