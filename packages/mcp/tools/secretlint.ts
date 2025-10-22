import type { MCPTextResponse, ToolContext } from '../types.ts';
import { lintSource } from '@secretlint/core';
import * as recommend from '@secretlint/secretlint-rule-preset-recommend';
import { promises as fs } from 'node:fs';
import diagnostics from 'diagnostics';
import { join, resolve } from 'node:path';
import { z } from 'zod';

interface SecretlintArgs {
  /** Absolute or relative path to scan */
  target: string;
  /** Treat warnings as errors. Defaults to true. */
  strict?: boolean;
}

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
async function collectFiles(root: string): Promise<string[]> {
  const queue: string[] = [root];
  const files: string[] = [];

  while (queue.length) {
    const current = queue.pop()!;
    const stats = await statSafe(current);
    if (!stats) continue;

    if (stats.isDirectory()) {
      const dirEntries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (DEFAULT_EXCLUDES.has(entry.name)) continue;
        if (entry.name.startsWith('.git')) continue;
        queue.push(join(current, entry.name));
      }
      continue;
    }

    if (stats.isFile()) files.push(current);
  }

  return files;
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
export function secretlint(_context: ToolContext) {
  async function exec({ target, strict = true }: SecretlintArgs): Promise<MCPTextResponse> {
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

    const files = stats.isDirectory() ? await collectFiles(root) : [root];
    if (!files.length) {
      return {
        content: [{ type: 'text', text: `No files found to scan at ${root}.` }]
      };
    }

    const coreConfig = {
      rules: [
        {
          id: '@secretlint/secretlint-rule-preset-recommend',
          rule: (recommend as any).creator || (recommend as any)
        }
      ]
    } as any;

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
          config: coreConfig,
          locale: 'en',
          maskSecrets: false,
          noPhysicFilePath: true
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
    const response: MCPTextResponse = {
      content: [{ type: 'text', text }]
    };

    if (issues.some(issue => issue.severity === 'error')) {
      response.isError = true;
      response.structuredContent = {
        ok: false,
        errors: issues.filter(issue => issue.severity === 'error'),
        warnings: issues.filter(issue => issue.severity === 'warning')
      };
    } else {
      response.structuredContent = {
        ok: true,
        warnings: issues
      };
    }

    return response;
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


