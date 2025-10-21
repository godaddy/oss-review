import type { MCPTextResponse, ToolContext } from '../types.ts';
import { z } from 'zod';

interface Args {
  query: string;
}

/**
 * Create search tool for MCP server (boilerplate).
 *
 * @param context - Tool context containing server and optional configuration
 * @returns Tool definition with metadata and exec()
 */
export function search(context: ToolContext) {
  /**
   * Execute the search tool.
   *
   * @param args - Search arguments
   * @param args.query - Search query string
   * @returns MCP text response with JSON string of results
   */
  async function exec({ query }: Args): Promise<MCPTextResponse> {
    if (!query || !query.trim()) return { content: [{ type: 'text', text: 'Query is required' }], isError: true };
    const results = [
      { id: 'example', name: 'Example', description: 'Example result' }
    ];
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }

  return {
    exec,
    title: 'Search Things',
    description: 'Search xyz (boilerplate).',
    inputSchema: {
      query: z.string().min(1).describe('Search query string')
    }
  };
}

