import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import packageInfo from '../../package.json' with { type: 'json' };
import type { Prompts, PromptDefinition } from './types.ts';
import { entries } from './resources/entries.ts';
import { review } from './prompts/review.ts';
import { search } from './tools/search.ts';
import { readFileSync } from 'node:fs';
import diagnostics from 'diagnostics';
import { join } from 'node:path';
import type { ConfigInstance } from '../config/index.ts';

const debug = diagnostics('oss-review:mcp');

/**
 * Bootstrap and manage the MCP server lifecycle.
 */
export interface ServerOptions {
  config?: ConfigInstance;
}

export class Server {
  private server: McpServer;
  private config: ConfigInstance;

  /**
   * Bootstrap a new MCP server instance with a mandatory configuration.
   *
   * @param options - Server initialisation options including required config
   */
  constructor(options: ServerOptions = {}) {
    if (!options.config) throw new Error('MCP server requires a configuration instance.');

    this.config = options.config;
    this.server = new McpServer({
      title: 'OSS Review MCP Server',
      version: packageInfo.version,
      name: packageInfo.name
    }, {
      //
      // Instructions describing how to use the server and its features, which
      // should allow LLMs/Agents to use the server correctly.
      //
      instructions: this.template(readFileSync(join(import.meta.dirname, 'instructions.md'), 'utf8'), {
        profile: this.config.getProfile(),
        version: packageInfo.version
      })
    });
    this.tools({
      search: search({ server: this, config: this.config })
    });

    this.resources({
      entries: entries({ server: this, config: this.config })
    });

    this.prompts({
      review: review({ server: this, config: this.config })
    });
  }

  /**
   * Register tools on the MCP server.
   *
   * @param tools - Mapping of tool name to tool definition with metadata and exec()
   */
  private tools(tools: Record<string, any>): void {
    Object.entries(tools).forEach(([name, tool]) => {
      this.server.registerTool(name, {
        title: tool.title.trim(),
        description: tool.description.trim(),
        inputSchema: tool.inputSchema
      }, async (args: any, extra?: any) => {
        try {
          return await tool.exec(args, extra);
        } catch (error) {
          debug('failed to execute tool', error);

          return {
            isError: true,
            contents: [{
              type: 'text',
              text: error instanceof Error ? error.message : String(error)
            }]
          };
        }
      });
    });
  }

  /**
   * Register resources on the MCP server.
   *
   * @param resources - Mapping of resource name to resource definition with template and read()
   */
  private resources(resources: Record<string, any>): void {
    Object.entries(resources).forEach(([name, resource]) => {
      this.server.registerResource(name, resource.template, {
        title: resource.title.trim(),
        description: resource.description.trim()
      }, async (uri: any, variables: any) => {
        try {
          return await resource.read({ params: { uri: uri.toString() } });
        } catch (error) {
          debug('failed to read resource', error);

          return {
            isError: true,
            contents: [{
              mimeType: 'text/markdown',
              text: error instanceof Error ? error.message : String(error),
              uri
            }]
          };
        }
      });
    });
  }

  /**
   * Register prompts on the MCP server.
   *
   * @param prompts - Mapping of prompt name to prompt definition with metadata and exec()
   */
  private prompts(prompts: Prompts): void {
    Object.entries(prompts).forEach(([name, prompt]: [string, PromptDefinition]) => {
      this.server.registerPrompt(name, {
        title: prompt.title.trim(),
        description: prompt.description.trim(),
        argsSchema: prompt.argsSchema
      }, async (args: any, extra?: any) => {
        try {
          return await prompt.exec(args, extra);
        } catch (error) {
          debug('failed to execute prompt', error);

          return {
            isError: true,
            description: prompt.description.trim(),
            messages: [{
              role: 'assistant',
              content: {
                type: 'text',
                text: error instanceof Error ? error.message : String(error)
              }
            }]
          };
        }
      });
    });
  }

  /**
   * Render a template string using double-curly placeholders.
   *
   * @param input - Template string containing placeholders (e.g. {{ profile.name }})
   * @param data - Data map used to resolve placeholder values
   * @returns Rendered string with placeholders replaced when data is available
   */
  public template(input: string, data: Record<string, unknown>): string {
    return input.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => {
      let value: unknown = data;
      for (const segment of key.split('.')) {
        if (value && typeof value === 'object' && segment in (value as Record<string, unknown>)) {
          value = (value as Record<string, unknown>)[segment];
        } else {
          value = undefined;
          break;
        }
      }

      if (value === undefined || value === null) return match;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  /**
   * Start the MCP server.
   *
   * If no transport is provided, uses stdio transport by default.
   */
  /**
   * Start the MCP server using the provided transport.
   *
   * @param transport - Optional transport instance (defaults to stdio)
   * @returns Promise resolving once the server is connected
   */
  async start(transport?: any) {
    const t = transport || new StdioServerTransport();

    await this.server.connect(t);
    return this.server;
  }

  /**
   * Close the MCP server and underlying transport if available.
   */
  async close(): Promise<void> {
    try {
      this.server.close();
    } catch (error) {
      debug('failed to close server', error);
    }
  }
}

/**
 * Factory for creating a configured MCP server instance.
 *
 * @param options - Server initialisation options including configuration
 * @returns New MCP server ready for start()
 */
export function mcp(options: ServerOptions = {}): Server {
  debug('creating oss-review mcp instance');
  return new Server(options);
}

/**
 * Simple templating helper using double-curly placeholders (e.g. {{ year }}, {{ profile.name }}).
 *
 * @param template - Raw template string containing placeholders
 * @param data - Data object used for substitution
 * @returns Rendered template string with placeholders replaced
 */
export function template(template: string, data: Record<string, unknown>): string {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => {
    let value: unknown = data;
    for (const segment of key.split('.')) {
      if (value && typeof value === 'object' && segment in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[segment];
      } else {
        value = undefined;
        break;
      }
    }

    if (value === undefined || value === null) return match;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

