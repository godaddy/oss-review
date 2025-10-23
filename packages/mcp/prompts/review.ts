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

MANUAL REVIEW AREAS (tools cannot detect these):

Business Logic and Competitive Advantage Assessment:
- Identify code with high complexity (likely >100 lines per function, nested conditionals, complex algorithms) that may represent proprietary business logic
- Look for classes/functions named: *PricingEngine*, *RecommendationAlgorithm*, *FraudDetector*, *RiskScorer*, or containing "Strategy"/"Policy" suffixes
- Flag comments containing: "proprietary", "confidential", "patent", "competitive advantage", "trade secret", or references to pricing/margins/costs/recommendations/fraud/risk
- Assess whether algorithms are generic implementations or contain domain-specific optimizations representing competitive advantage

Code Complexity and IP Protection:
- Identify functions with apparent high cyclomatic complexity (deeply nested logic, multiple branches)
- Look for standalone modules with minimal dependencies (easier to copy/extract—higher IP risk)
- Check for code in /internal/, /proprietary/, /core/, or /engine/ directories
- Flag database schema files that reveal data models and business relationships
- Assess authentication/authorization code for custom security mechanisms

Export Control and Cryptography:
- CRITICAL: Flag any cryptographic implementations (encryption, hashing beyond standard libraries, custom crypto algorithms)
- Note: Cryptographic code may require ECCN classification and export control review (legal requirement with criminal penalties)
- Look for: crypto libraries, encryption/decryption functions, key generation, certificate handling
- Escalate immediately if found—this requires legal review before release

Patent and Novel Algorithm Detection:
- Identify novel algorithms or unique approaches to common problems
- Flag comments like "TODO: Patent this", "novel approach", "innovative solution"
- Look for code implementing known company patents (if patent portfolio is available)
- Suggest patent search for novel algorithms before open source release

Repository Sanitization and History Concerns:
- Check recent commit history (last 6 months) for rapid development indicating active competitive work
- Identify TODO comments with employee references: TODO(username) patterns
- Look for internal URLs in: comments, configuration files, error messages, build scripts
- Assess whether codebase contains customer/partner names that should be generalized
- Check for configuration files with production values (should use environment variables)

Maintainer Commitment and Community Readiness:
- Assess if this appears to be a "side project" vs. strategic investment
- Look for indicators of maintenance commitment: recent updates, clear roadmap, responsive to issues
- Evaluate if there's sufficient documentation for external contributors
- Consider: Is this code maintained and actively developed, or a one-time dump?
- Red flag: Releasing unmaintained code damages reputation—recommend against release if no maintenance commitment exists

Strategic and Architectural Exposure:
- Assess whether code reveals internal architecture, microservice topology, or infrastructure details
- Identify if error messages expose internal tech stack, service names, or network structure
- Look for build scripts referencing internal artifact repositories or build systems
- Consider: Does releasing this code provide competitors with insights into our technical approach?

License and Contribution Policy Hygiene:
- For projects accepting contributions: Verify CLA/DCO strategy is defined
- Check for "Inbound=Outbound" licensing clarity (contributions come in under same license as project releases)
- Assess if contribution guidelines are clear and welcoming
- Verify Code of Conduct exists and includes enforcement procedures

Actions when gaps are found:
- Create missing docs from resources immediately using entries (names are defined by config). Typical names: LICENSE, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md.
- Summarize secretlint and search findings with precise file paths and minimal sanitized snippets.
- For business logic concerns: Recommend human review by engineering leadership and legal counsel before proceeding
- For export control concerns: STOP and escalate immediately—criminal penalties apply
- For IP/patent concerns: Recommend patent search and legal review
- For maintainer commitment gaps: Recommend establishing clear ownership and support commitments before release
- Propose CI steps: SBOM generation, SCA, and repository health checks. Where relevant, suggest BFG Repo-Cleaner commands (engineer-executed) for sensitive history.
- For architectural exposure: Suggest abstracting internal references to environment variables and generic interfaces

Risk Escalation Framework:
- LOW RISK: Generic utilities, framework wrappers, well-documented code with no proprietary logic → Recommend proceeding with automated checks
- MODERATE RISK: Domain-specific implementations, some business logic, active development → Recommend engineering review (2-week timeline)
- HIGH RISK: Core algorithms, pricing/fraud/recommendation engines, patent-protected code, recent rapid development, cryptographic implementations → Recommend OSRB approval with legal/security review (presume denial unless strong business case)
- IMMEDIATE ESCALATION: Cryptographic code (export control), hardcoded production credentials, customer PII, comments indicating trade secrets

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
