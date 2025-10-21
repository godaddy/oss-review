import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import packageInfo from '../../package.json' with { type: 'json' };
import { entries } from './resources/entries.ts';
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
  private config?: ConfigInstance;

  /**
   * Create a new MCP server instance with a single search tool and entries resource.
   */
  constructor(options: ServerOptions = {}) {
    this.config = options.config;
    this.server = new McpServer({
      title: 'OSS Review MCP Server',
      name: packageInfo.name,
      version: packageInfo.version
    }, {
      //
      // Instructions describing how to use the server and its features, which
      // should allow LLMs/Agents to use the server correctly.
      //
      instructions: readFileSync(join(import.meta.dirname, 'instructions.md'), 'utf8')
    });

    this.tools({
      search: search({ server: this, config: this.config })
    });

    this.resources({
      entries: entries({ server: this, config: this.config })
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
   * Start the MCP server.
   *
   * If no transport is provided, uses stdio transport by default.
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
 * Factory for creating a new MCP server instance.
 */
export function mcp(options: ServerOptions = {}): Server {
  debug('creating oss-review mcp instance');
  return new Server(options);
}

