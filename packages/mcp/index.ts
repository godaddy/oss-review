import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { entries } from './resources/entries.ts';
import { search } from './tools/search.ts';
import diagnostics from 'diagnostics';

const debug = diagnostics('oss-review:mcp');

/**
 * Bootstrap and manage the MCP server lifecycle.
 */
export class Server {
  private server: McpServer;

  /**
   * Create a new MCP server instance with a single search tool and entries resource.
   */
  constructor() {
    this.server = new McpServer({
      title: 'OSS Review MCP Server',
      name: 'oss-review',
      version: '0.0.1'
    });

    this.tools({
      search: search({ server: this })
    });

    this.resources({
      entries: entries({ server: this })
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
      const transport = (this.server as any).transport;
      if (transport && typeof transport.close === 'function') await transport.close();
    } catch {}
    try {
      if (typeof (this.server as any).close === 'function') await (this.server as any).close();
    } catch {}
  }
}

/**
 * Factory for creating a new MCP server instance.
 */
export function mcp(): Server {
  debug('creating oss-review mcp instance');
  return new Server();
}

