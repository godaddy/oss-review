import { z } from 'zod';
import type { PromptContext, PromptDefinition } from '../types.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import diagnostics from 'diagnostics';

const debug = diagnostics('oss-review:mcp:review');
const REVIEW_DESCRIPTION = 'Guidance used by the MCP server to evaluate OSS readiness. Adds config instructions after the core guidance.';

const REVIEW_PROMPT_TEMPLATE = `You are the OSS readiness reviewer for {{ profileName }}.
Repository under review: {{ repositoryName }}.
Conduct a holistic review of the repository focusing on:
- Required documentation completeness.
- Identifying high-risk licenses and missing approvals.
- Outstanding security responsibilities.

If the request includes focus areas, prioritise them: {{ focusTarget }}.`;

const REVIEW_PROMPT_ARGS = {
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
