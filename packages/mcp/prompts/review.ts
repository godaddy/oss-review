import { z } from 'zod';
import type { PromptContext, PromptDefinition } from '../types.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import diagnostics from 'diagnostics';

const debug = diagnostics('oss-review:mcp:review');
const REVIEW_DESCRIPTION = 'Guidance used by the MCP server to evaluate OSS readiness. Adds config instructions after the core guidance.';

const REVIEW_PROMPT_TEMPLATE = `
You are the OSS readiness reviewer for {{ profileName }}.
Repository under review: {{ repositoryName }}.
Conduct a holistic review of the repository focusing on:
- Required documentation completeness.
- Identifying high-risk licenses and missing approvals.
- Outstanding security responsibilities.

If the request includes focus areas, prioritise them: {{ focusTarget }}.

Use the following tools and resources to conduct your review:
- "search": Search files for policy violations based on detection patterns configured in the OSS review policy. Specify a target path and optionally filter by detection bucket (e.g., "secrets", "sensitive-links"). Returns findings with severity levels and file locations.
- "secretlint": Scan files or directories for leaked secrets using Secretlint recommended rules (args: { target, strict? }). Treat warnings as errors by default (strict: true). Scan repo root and, for monorepos, each package path.
- "licenses": Audit project and dependency licenses against policy using SBOM data. Validates outbound licensing using allowed (green) licenses from config and optionally analyzes transitive dependencies via SBOMs.
- "security": Audit project dependencies for known vulnerabilities using advisory providers (currently npm audit). Accepts severity thresholds and ignore lists.
- "entries" resource: Fetch required document templates by URI (oss-review://resources/{name}) based on what the config exposes. When a required file is missing, read the resource and create the file in the appropriate location.

Note: If sensitive content is discovered in git history, recommend BFG Repo-Cleaner commands for engineers to manually execute (BFG is not an MCP tool).

Checklist derived from internal OSS readiness research (condensed):
- Documentation and process files
  - Ensure presence of: LICENSE, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, README.md, and a basic GOVERNANCE.md when appropriate.
  - Monorepos: verify each package directory containing a manifest (e.g. package.json) has a LICENSE file and basic README; if missing, fetch from resources and store them.
  - If files are missing, fetch via entries resource and write them to the repository.
- Secrets and sensitive information
  - Run secretlint against the repository root; repeat for each package in a monorepo.
  - Flag hardcoded credentials, tokens, keys, JWTs, basic auth strings, and context-labeled secrets (api/auth/secret/key/token/password variables).
- Internal references (non-secrets but sensitive)
  - Use the search tool with appropriate detection buckets to find internal URLs/domains, private IPs, internal API endpoints (/admin, /internal, /debug, /metrics), database connection strings, and infrastructure identifiers (e.g. Kubernetes namespaces, service mesh hosts).
- Licensing and third-party usage (high-level)
  - Use the licenses tool to validate outbound licensing and detect non-green licenses. Where possible, generate or load SBOM and review transitive dependencies.
- Security posture and repo health (high-level)
  - Use the security tool to check for known vulnerabilities in dependencies.
  - Verify presence of SECURITY.md, consider baseline security checks (branch protection, code review). Recommend adoption of automated checks when gaps exist.
- Business logic/IP awareness
  - Escalate complex, proprietary logic (pricing/recommendation/fraud engines) for human review when discovered; avoid reproducing sensitive details in output.

Actions when gaps are found:
- Create missing docs from resources immediately using entries (names are defined by config). Typical names: LICENSE, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md.
- Summarize secretlint and search findings with precise file paths and minimal sanitized snippets.
- Propose CI steps: SBOM generation, SCA, and repository health checks. Where relevant, suggest BFG Repo-Cleaner commands (engineer-executed) for sensitive history.

`;

/**
 * Reusable argument schema for the review prompt and tool.
 * Exported so the review tool can reuse the same schema definition.
 */
export const REVIEW_PROMPT_ARGS = {
  repository: z.string().trim().min(1, 'Repository identifier is required.').describe('Repository or project identifier being reviewed.'),
  focus: z.string().trim().min(1).optional().describe('Optional focus area that should receive additional scrutiny.')
} as const;

const REVIEW_PROMPT_SCHEMA = z.object(REVIEW_PROMPT_ARGS);

/**
 * Create the `review` prompt definition that merges configuration data with templated guidance.
 *
 * @param context - Prompt context containing the active server and configuration
 * @returns Fully populated prompt definition ready for registration
 */
export function review({ config, server}: PromptContext): PromptDefinition {
  return {
    title: 'OSS Readiness Review',
    description: REVIEW_DESCRIPTION,
    argsSchema: REVIEW_PROMPT_ARGS,
    async exec(rawArgs = {}) {
      const parsed = REVIEW_PROMPT_SCHEMA.safeParse(rawArgs);
      if (!parsed.success) throw new Error(parsed.error.message);

      const args = parsed.data;

      const profile = config.getProfile();
      const repositoryName = args.repository;
      const templateData = {
        focusTarget: args.focus ?? 'general readiness',
        profileName: profile.name ?? 'this project',
        year: new Date().getFullYear(),
        repositoryName,
        profile,
        args
      };

      // Load persona prefix from local markdown (best-effort; ignore if unavailable)
      let persona: string | undefined;

      try {
        const personaRaw = await readFile(fileURLToPath(new URL('./persona.md', import.meta.url)), 'utf8');
        const templated = server.template(personaRaw, templateData).trim();
        if (templated) persona = templated;
      } catch (e) {
        debug('Persona file not found or unreadable; proceeding without prefix', e);
      }

      const coreGuidance = server.template(REVIEW_PROMPT_TEMPLATE, templateData).trim();

      const messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> = [];

      if (persona) {
        messages.push({
          role: 'user',
          content: { type: 'text', text: persona }
        });
      }

      messages.push({
        role: 'user',
        content: { type: 'text', text: coreGuidance }
      });

      const instruction = config.getInstructions('review');
      if (instruction?.content?.trim()) {
        messages.push({
          role: 'user',
          content: { type: 'text', text: server.template(instruction.content, templateData).trim() }
        });
      }

      return {
        description: REVIEW_DESCRIPTION,
        messages
      };
    }
  };
}
