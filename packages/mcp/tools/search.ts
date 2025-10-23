import type { MCPTextResponse, ToolContext } from '../types.ts';
import type { DetectionPattern } from '../../config/index.ts';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import diagnostics from 'diagnostics';
import { z } from 'zod';

const debug = diagnostics('oss-review:mcp:tool:search');

const DEFAULT_EXCLUDES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  'dist',
  'build'
]);

interface SearchArgs {
  /** Absolute or relative path to scan */
  target: string;
  /** Optional specific bucket to search (e.g., 'secrets', 'sensitive-links') */
  bucket?: string;
}

interface SearchIssue {
  filePath: string;
  message: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  line?: number;
  column?: number;
  patternId?: string;
  patternTitle?: string;
  remediation?: string;
}

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
 * @param excludes - Set of directory names to skip.
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

/**
 * Search file content for pattern matches and return line-level issues.
 *
 * @param filePath - Absolute path to the file being scanned.
 * @param content - File content as string.
 * @param pattern - Detection pattern to search for.
 * @returns Array of issues found in the file.
 */
function searchContent(filePath: string, content: string, pattern: DetectionPattern): SearchIssue[] {
  const issues: SearchIssue[] = [];
  const lines = content.split('\n');
  const { type = 'regex', match, id, title, severity = 'medium', remediation } = pattern;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    let matched = false;
    let columnIndex: number | undefined;

    if (type === 'keyword') {
      // Simple case-sensitive keyword search
      const index = line.indexOf(match);
      if (index !== -1) {
        matched = true;
        columnIndex = index;
      }
    } else if (type === 'regex') {
      // Regex pattern matching
      try {
        const regex = new RegExp(match, 'g');
        const regexMatch = regex.exec(line);
        if (regexMatch) {
          matched = true;
          columnIndex = regexMatch.index;
        }
      } catch (error) {
        debug('invalid regex pattern %s: %s', match, (error as Error).message);
        continue;
      }
    }

    if (matched) {
      issues.push({
        filePath,
        message: title || `Pattern match: ${id}`,
        severity,
        line: lineIndex + 1,
        column: columnIndex,
        patternId: id,
        patternTitle: title,
        remediation
      });
    }
  }

  return issues;
}

/**
 * Render a search result summary as human-readable text.
 *
 * @param targetPath - The root path provided for scanning.
 * @param scanned - Number of files processed.
 * @param issues - Collection of detected issues.
 * @returns Multi-line summary suitable for MCP responses.
 */
function formatIssues(targetPath: string, scanned: number, issues: SearchIssue[]): string {
  const bySeverity = {
    critical: issues.filter(i => i.severity === 'critical').length,
    high: issues.filter(i => i.severity === 'high').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    low: issues.filter(i => i.severity === 'low').length,
    info: issues.filter(i => i.severity === 'info').length
  };

  const lines = [
    `Detection scan for ${targetPath}`,
    `Scanned files: ${scanned}`,
    `Issues found: ${issues.length} (critical: ${bySeverity.critical}, high: ${bySeverity.high}, medium: ${bySeverity.medium}, low: ${bySeverity.low}, info: ${bySeverity.info})`
  ];

  if (issues.length) {
    lines.push('\nDetails:');
    for (const issue of issues) {
      const location = issue.line ? `:${issue.line}${issue.column !== undefined ? `:${issue.column}` : ''}` : '';
      const pattern = issue.patternId ? ` [${issue.patternId}]` : '';
      lines.push(`- [${issue.severity.toUpperCase()}] ${issue.filePath}${location}${pattern} — ${issue.message}`);
      if (issue.remediation) {
        lines.push(`  Remediation: ${issue.remediation}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Create search tool for MCP server.
 *
 * Scans files in a target directory for patterns defined in the detection configuration.
 * Supports both regex and keyword pattern matching across multiple buckets.
 *
 * @param context - Tool context containing server and optional configuration
 * @returns Tool definition with metadata and exec()
 */
export function search(context: ToolContext) {
  /**
   * Execute the search tool.
   *
   * @param args - Search arguments
   * @param args.target - Target path to scan
   * @param args.bucket - Optional bucket name to filter patterns
   * @returns MCP text response with search results
   */
  async function exec(args: SearchArgs): Promise<MCPTextResponse> {
    const { target, bucket } = args;
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

    // Collect all detection patterns
    const detectionBuckets = context.config.getDetection();
    const patterns: DetectionPattern[] = [];

    if (bucket) {
      // Filter by specific bucket
      const bucketPatterns = context.config.getDetection(bucket) as DetectionPattern[];
      if (bucketPatterns.length === 0) {
        return {
          isError: true,
          content: [{ type: 'text', text: `No detection patterns found in bucket: ${bucket}` }]
        };
      }
      patterns.push(...bucketPatterns);
    } else {
      // Collect from all buckets
      for (const bucketName in detectionBuckets) {
        const bucketPatterns = context.config.getDetection(bucketName) as DetectionPattern[];
        patterns.push(...bucketPatterns);
      }
    }

    if (patterns.length === 0) {
      return {
        content: [{ type: 'text', text: 'No detection patterns configured.' }],
        isError: false
      };
    }

    // Collect files to scan
    const excludes = new Set<string>(DEFAULT_EXCLUDES);
    const files = stats.isDirectory() ? await collectFiles(root, excludes) : [root];

    if (!files.length) {
      return {
        content: [{ type: 'text', text: `No files found to scan at ${root}.` }]
      };
    }

    // Scan files for pattern matches
    const issues: SearchIssue[] = [];

    for (const filePath of files) {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        debug('failed to read file %s', filePath, error);
        continue;
      }

      for (const pattern of patterns) {
        const fileIssues = searchContent(filePath, content, pattern);
        issues.push(...fileIssues);
      }
    }

    const text = formatIssues(root, files.length, issues);
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const highIssues = issues.filter(i => i.severity === 'high');

    return {
      content: [{ type: 'text', text }],
      isError: false,
      structuredContent: {
        ok: criticalIssues.length === 0 && highIssues.length === 0,
        scannedFiles: files.length,
        totalIssues: issues.length,
        issues: issues.map(issue => ({
          filePath: issue.filePath,
          line: issue.line,
          column: issue.column,
          severity: issue.severity,
          patternId: issue.patternId,
          message: issue.message,
          remediation: issue.remediation
        }))
      }
    };
  }

  return {
    exec,
    title: 'Pattern Detection Search',
    description: 'Search files for policy violations based on detection patterns configured in the OSS review policy.',
    inputSchema: {
      target: z.string().min(1).describe('Absolute path to a file or directory to scan for detection patterns.'),
      bucket: z.string().optional().describe('Optional detection bucket name to filter patterns (e.g., "secrets", "sensitive-links").')
    }
  };
}

