import type { MCPTextResponse, ToolContext } from '../types.ts';
import { lintSource } from '@secretlint/core';
import * as recommend from '@secretlint/secretlint-rule-preset-recommend';
import { promises as fs } from 'node:fs';
import diagnostics from 'diagnostics';
import { join, resolve } from 'node:path';
import { z } from 'zod';

type SecretlintArgs = {
  /** Absolute or relative path to scan */
  target: string;
  /** Treat warnings as errors. Defaults to true. */
  strict?: boolean;
  /** Additional directories to ignore while walking folders. */
  exclude?: unknown;
  /** Optional locale supplied to Secretlint. */
  locale?: string;
  /** Whether secrets should be masked in the output (Secretlint option). */
  maskSecrets?: boolean;
  /** Support typo variant for backwards compatibility. */
  noPhysicFilePath?: boolean;
  /** Secretlint option controlling whether file paths are considered physical. */
  noPhysicalFilePath?: boolean;
  /** Optional preset or rule references to load Secretlint rules. */
  preset?: unknown;
  /** Optional explicit rule descriptors to load Secretlint rules. */
  rules?: unknown;
  /** Optional full Secretlint config override. */
  secretlintConfig?: unknown;
  /** Optional full Secretlint config override using generic key. */
  config?: unknown;
} & Record<string, unknown>;

interface SecretlintIssue {
  filePath: string;
  message: string;
  severity: 'error' | 'warning';
  line?: number;
  column?: number;
  ruleId?: string;
}

const debug = diagnostics('oss-review:mcp:tool:secretlint');

const DEFAULT_EXCLUDES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  'dist',
  'build'
]);

/**
 * Safely read filesystem stats for a path, returning null when not found.
 *
 * @param path - Absolute path to inspect.
 * @returns Resolved stats or null if the path does not exist.
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
 * Walk a directory breadth-first and gather file paths, skipping common generated folders.
 *
 * @param root - Absolute directory path to traverse.
 * @returns List of discovered file paths.
 */
async function collectFiles(root: string, excludes: Set<string>): Promise<string[]> {
  const queue: string[] = [root];
  const files: string[] = [];

  while (queue.length) {
    const current = queue.pop()!;
    const stats = await statSafe(current);
    if (!stats) continue;

    if (stats.isDirectory()) {
      const dirEntries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (excludes.has(entry.name)) continue;
        if (entry.name.startsWith('.git')) continue;
        queue.push(join(current, entry.name));
      }
      continue;
    }

    if (stats.isFile()) files.push(current);
  }

  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function loadSecretlintModule(moduleId: string): Promise<unknown> {
  try {
    const mod = await import(moduleId);
    const candidate = (mod as any)?.default ?? mod;
    return candidate?.creator ?? candidate?.default ?? candidate;
  } catch (error) {
    throw new Error(`Failed to load Secretlint module "${moduleId}": ${(error as Error).message}`);
  }
}

interface ResolvedRule {
  id: string;
  rule: unknown;
  options?: unknown;
}

async function resolveRuleEntry(entry: unknown): Promise<ResolvedRule | null> {
  if (!entry) return null;

  if (typeof entry === 'string') {
    const rule = await loadSecretlintModule(entry);
    return { id: entry, rule };
  }

  if (isRecord(entry)) {
    if (typeof entry.rule !== 'undefined') {
      const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : undefined;
      if (!id) throw new Error('Custom Secretlint rule entry requires a non-empty "id" when providing inline "rule".');
      const descriptor: ResolvedRule = { id, rule: entry.rule };
      if ('options' in entry) descriptor.options = entry.options;
      return descriptor;
    }

    const moduleName = typeof entry.module === 'string' && entry.module.trim()
      ? entry.module.trim()
      : typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : undefined;

    if (!moduleName) return null;

    const rule = await loadSecretlintModule(moduleName);
    const descriptor: ResolvedRule = {
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : moduleName,
      rule
    };
    if ('options' in entry) descriptor.options = entry.options;
    return descriptor;
  }

  return null;
}

async function resolveRules(value: unknown): Promise<ResolvedRule[]> {
  const inputs = Array.isArray(value) ? value : typeof value !== 'undefined' ? [value] : [];
  const resolved: ResolvedRule[] = [];

  for (const entry of inputs) {
    const rule = await resolveRuleEntry(entry);
    if (rule) resolved.push(rule);
  }

  return resolved;
}

/**
 * Render a Secretlint result summary as human-readable text.
 *
 * @param targetPath - The root path provided for scanning.
 * @param scanned - Number of files processed.
 * @param issues - Collection of detected issues.
 * @returns Multi-line summary suitable for MCP responses.
 */
function formatIssues(targetPath: string, scanned: number, issues: SecretlintIssue[]): string {
  const errorCount = issues.filter(issue => issue.severity === 'error').length;
  const warningCount = issues.filter(issue => issue.severity === 'warning').length;

  const lines = [
    `Secretlint scan for ${targetPath}`,
    `Scanned files: ${scanned}`,
    `Issues found: ${issues.length} (errors: ${errorCount}, warnings: ${warningCount})`
  ];

  if (issues.length) {
    lines.push('\nDetails:');
    for (const issue of issues) {
      const location = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : '';
      const rule = issue.ruleId ? ` (${issue.ruleId})` : '';
      lines.push(`- [${issue.severity.toUpperCase()}] ${issue.filePath}${location}${rule} — ${issue.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create the Secretlint MCP tool implementation.
 *
 * @param _context - Current MCP tool context (unused but reserved for future config wiring).
 * @returns Tool definition exposing metadata, schema, and executor.
 */
export function secretlint(context: ToolContext) {
  const config = context.config.getTool('secretlint') ?? {};
  const defaults = typeof config === 'object' && !Array.isArray(config) ? { ...(config as Record<string, unknown>) } : {};

  async function exec(rawArgs: SecretlintArgs): Promise<MCPTextResponse> {
    const mergedArgs = { ...defaults, ...rawArgs } as SecretlintArgs;
    const resolvedStrict = mergedArgs.strict ?? defaults.strict;
    const strict = typeof resolvedStrict === 'boolean' ? resolvedStrict : true;
    const { target } = mergedArgs;
    const trimmed = target?.trim();
    if (!trimmed) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Target path is required.' }]
      };
    }

    const root = resolve(trimmed);
    const stats = await statSafe(root);
    if (!stats) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Target not found: ${root}` }]
      };
    }

    const excludes = new Set<string>(DEFAULT_EXCLUDES);

    const excludeValues = mergedArgs.exclude ?? defaults.exclude;
    if (Array.isArray(excludeValues)) {
      for (const value of excludeValues) {
        if (typeof value === 'string' && value.trim()) excludes.add(value.trim());
      }
    } else if (excludeValues instanceof Set) {
      for (const value of excludeValues) {
        if (typeof value === 'string' && value.trim()) excludes.add(value.trim());
      }
    } else if (typeof excludeValues === 'string' && excludeValues.trim()) {
      excludes.add(excludeValues.trim());
    }

    const files = stats.isDirectory() ? await collectFiles(root, excludes) : [root];
    if (!files.length) {
      return {
        content: [{ type: 'text', text: `No files found to scan at ${root}.` }]
      };
    }

    const presetInput = mergedArgs.preset ?? defaults.preset;
    const rulesInput = mergedArgs.rules ?? mergedArgs.rule ?? defaults.rules ?? defaults.rule;
    const explicitConfig = mergedArgs.secretlintConfig ?? mergedArgs.config ?? defaults.secretlintConfig ?? defaults.config;

    let configRules: ResolvedRule[] | undefined;
    let configObject: Record<string, unknown> | undefined;

    if (explicitConfig && isRecord(explicitConfig)) {
      configObject = { ...explicitConfig };
    }

    if (!configObject) {
      const resolvedRules = await resolveRules(rulesInput);
      if (resolvedRules.length) {
        configRules = resolvedRules;
      }

      if ((!configRules || configRules.length === 0) && presetInput) {
        const presetRules = await resolveRules(presetInput);
        if (presetRules.length) configRules = presetRules;
      }

      if (!configRules || configRules.length === 0) {
        configRules = [{
          id: '@secretlint/secretlint-rule-preset-recommend',
          rule: (recommend as any).creator || (recommend as any)
        }];
      }

      configObject = {
        rules: configRules.map(rule => {
          const descriptor: Record<string, unknown> = {
            id: rule.id,
            rule: rule.rule
          };
          if (typeof rule.options !== 'undefined') descriptor.options = rule.options;
          return descriptor;
        })
      };
    }

    const issues: SecretlintIssue[] = [];

    for (const filePath of files) {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        debug('failed to read file %s', filePath, error);
        issues.push({
          filePath,
          message: (error as Error).message,
          severity: 'warning'
        });
        continue;
      }

      const result = await lintSource({
        source: {
          content,
          filePath,
          contentType: 'text'
        },
        options: {
          config: configObject,
          locale: (mergedArgs.locale ?? defaults.locale ?? 'en') as string,
          maskSecrets: Boolean(mergedArgs.maskSecrets ?? defaults.maskSecrets ?? false),
          noPhysicFilePath: Boolean(mergedArgs.noPhysicFilePath ?? defaults.noPhysicalFilePath ?? defaults.noPhysicFilePath ?? true)
        }
      });

      if (!result?.messages?.length) continue;

      for (const message of result.messages as any[]) {
        const severity = message.severity === 2 || strict ? 'error' : 'warning';
        issues.push({
          filePath,
          message: message.message || 'Secretlint violation',
          severity,
          line: message.loc?.start?.line,
          column: message.loc?.start?.column,
          ruleId: message.ruleId || message.ruleIdList?.[0]
        });
      }
    }

    const text = formatIssues(root, files.length, issues);
    const errors = issues.filter(issue => issue.severity === 'error');
    const warnings = issues.filter(issue => issue.severity === 'warning');

    return {
      content: [{ type: 'text', text }],
      isError: false,
      structuredContent: {
        ok: errors.length === 0,
        errors,
        warnings
      }
    };
  }

  return {
    exec,
    title: 'Secretlint Scan',
    description: 'Scan files under a target path using Secretlint recommended rules to catch leaked secrets.',
    inputSchema: {
      target: z.string().min(1).describe('Absolute path to a file or directory to scan with Secretlint.'),
      strict: z.boolean().optional().describe('Treat Secretlint warnings as errors (default: true).')
    }
  };
}


