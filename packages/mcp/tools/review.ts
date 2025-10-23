/**
 * MCP review tool that exposes the review prompt as a callable tool.
 * This allows AI agents to programmatically trigger reviews without requiring
 * user interaction with the prompt system.
 */
import type { MCPTextResponse, ToolContext } from '../types.ts';
import { z } from 'zod';
import { review as reviewPrompt, REVIEW_PROMPT_ARGS } from '../prompts/review.ts';
import diagnostics from 'diagnostics';

const debug = diagnostics('oss-review:mcp:tool:review');

/**
 * Zod schema for validation. Reuses the schema from the prompt definition
 * to ensure consistency between the prompt and tool interfaces.
 */
const INPUT_SCHEMA = z.object(REVIEW_PROMPT_ARGS);

/**
 * Factory returning the MCP tool definition registered under `review`.
 */
export function review(context: ToolContext) {
  // Create the prompt definition once during tool initialization
  const prompt = reviewPrompt(context);

  /**
   * Execute the review tool by invoking the underlying prompt and converting
   * the response to tool format.
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

    try {
      // Execute the prompt to get the review guidance
      const promptResult = await prompt.exec(args);

      // Convert prompt messages to tool response format
      const textContent = promptResult.messages
        .map((msg: { role: string; content: { type: string; text: string } }) => {
          if (msg.content.type === 'text') {
            return msg.content.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n---\n\n');

      return {
        isError: false,
        content: [{ type: 'text', text: textContent }],
        structuredContent: {
          repository: args.repository,
          focus: args.focus,
          messages: promptResult.messages
        }
      };
    } catch (error) {
      debug('failed to execute review tool', error);
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
      };
    }
  }

  return {
    exec,
    title: 'OSS Readiness Review',
    description: 'Execute a comprehensive OSS readiness review for a repository, providing guidance on security, licensing, documentation, and policy compliance.',
    inputSchema: REVIEW_PROMPT_ARGS
  };
}

