import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import diagnostics from 'diagnostics';

import type {
  AdvisoryFinding,
  AdvisoryProvider,
  AdvisoryProviderContext,
  AdvisoryProviderResult,
  AdvisoryProviderMetadata
} from './index.ts';
import { normaliseSeverity } from './index.ts';

const debug = diagnostics('oss-review:advisory:npm');

/**
 * Options controlling npm audit provider behaviour.
 */
export interface NpmAuditProviderOptions {
  /** Alternate npm executable to invoke (defaults to `npm`). */
  executable?: string;
  /** Custom spawn implementation (primarily for testing). */
  spawn?: typeof defaultSpawn;
}

interface NpmAuditFinding {
  /** Advisory identifier (GHSA or npm advisory id). */
  id: string;
  /** Name of the affected package. */
  module_name: string;
  /** Version installed. */
  version: string;
  /** Advisory title. */
  title: string;
  /** Advisory severity classification. */
  severity: string;
  /** Recommended remediation text. */
  recommendation?: string;
  /** Patched version if available. */
  patched_versions?: string;
  /** Advisory URL. */
  url?: string;
  /** CWE identifiers associated with the advisory. */
  cwe?: string[];
}

interface NpmAuditOutput {
  advisories?: Record<string, NpmAuditFinding>;
  vulnerabilities?: Record<string, { isDirect?: boolean; via: Array<string | { source: string; name: string }> }>;
  metadata?: {
    vulnerabilities: Record<string, number>;
  };
}

/**
 * Provider invoking `npm audit --json` to retrieve vulnerability advisories for the target project.
 */
export class NpmAuditProvider implements AdvisoryProvider {
  /**
   * Metadata describing the npm audit provider.
   */
  public readonly metadata: AdvisoryProviderMetadata = {
    id: 'npm-audit',
    title: 'npm Audit'
  };

  private readonly executable: string;
  private readonly spawnCommand: typeof defaultSpawn;

  /**
   * Create a new provider instance.
   *
   * @param options - Optional provider configuration overrides.
   */
  constructor(options: NpmAuditProviderOptions = {}) {
    this.executable = options.executable?.trim() || 'npm';
    this.spawnCommand = options.spawn ?? defaultSpawn;
  }

  /**
   * Execute npm audit within the target project and return normalized findings.
   *
   * @param context - Provider execution context describing the project under review.
   * @returns Promise resolving with the provider result payload.
   */
  public async run(context: AdvisoryProviderContext): Promise<AdvisoryProviderResult> {
    const cwd = context.target;
    const args = ['audit', '--json'];
    if (!context.includeDev) args.push('--production');

    debug('running npm %o in %s', args, cwd);

    const child: ChildProcess = this.spawnCommand(this.executable, args, {
      cwd,
      env: context.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
    });

    const [code] = await once(child, 'close');

    const stdoutText = stdoutChunks.join('');
    const stderrText = stderrChunks.join('');

    if (code !== 0 && !stdoutText.trim()) {
      throw new Error(`npm audit failed: ${stderrText.trim() || `exit code ${code}`}`);
    }

    let parsed: NpmAuditOutput;
    try {
      parsed = stdoutText.trim() ? JSON.parse(stdoutText) : { advisories: {} };
    } catch (error) {
      throw new Error(`Failed to parse npm audit output: ${(error as Error).message}`);
    }

    const findings = this.transform(parsed);

    const result: AdvisoryProviderResult = {
      findings,
      warnings: [],
      metadata: {
        ...this.metadata,
        version: undefined,
        command: {
          executable: this.executable,
          args
        }
      }
    };

    if (code !== 0 && stderrText.trim()) {
      result.warnings.push(stderrText.trim());
    }

    return result;
  }

  private transform(output: NpmAuditOutput): AdvisoryFinding[] {
    const advisories = output.advisories ?? {};
    const findings: AdvisoryFinding[] = [];

    for (const advisory of Object.values(advisories)) {
      const severity = normaliseSeverity(advisory.severity);

      findings.push({
        id: advisory.id,
        packageName: advisory.module_name,
        packageVersion: advisory.version,
        severity,
        title: advisory.title,
        recommendation: advisory.recommendation,
        fixedVersion: advisory.patched_versions,
        url: advisory.url,
        cwes: advisory.cwe,
        source: this.metadata.id
      });
    }

    return findings;
  }
}


