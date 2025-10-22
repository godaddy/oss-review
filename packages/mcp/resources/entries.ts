import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ResourceContext } from '../types.ts';
import { template } from '../index.ts';

/**
 * Create an MCP resource exposing configuration-defined documentation.
 *
 * @param context - Resource execution context including server and configuration
 * @returns Resource definition capable of listing and reading configured files
 */
export function entries({ config }: ResourceContext) {
  const resources = config.getResources();

  return {
    title: 'Configured Resources',
    description: 'Documentation and policy files defined by the active configuration.',
    template: new ResourceTemplate('oss-review://resources/{name}', {
      /**
       * List available resources.
       */
      list: async function listResources() {
        return {
          resources: resources.map((resource) => ({
            uri: `oss-review://resources/${encodeURIComponent(resource.name)}`,
            name: resource.name,
            title: resource.name,
            description: resource.path,
            mimeType: 'text/markdown'
          }))
        };
      }
    }),
    /**
     * Read a given resource URI and return file content when available.
     */
    async read(request: { params: { uri: string } }) {
      const uri = request.params.uri;
      const name = decodeURIComponent(uri.split('/').pop() ?? '');
      const resource = resources.find((entry) => entry.name === name);

      if (!resource) {
        return {
          isError: true,
          contents: [{
            mimeType: 'text/markdown',
            text: `Resource not found: ${uri}`,
            uri
          }]
        };
      }

      const absolutePath = resolve(resource.path);
      try {
        const text = await readFile(absolutePath, 'utf8');

        const rendered = template(text, {
          profile: config.getProfile(),
          year: new Date().getFullYear()
        });

        return {
          contents: [{
            mimeType: 'text/markdown',
            text: rendered,
            uri
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          contents: [{
            mimeType: 'text/markdown',
            text: `Failed to read resource ${resource.name} at ${absolutePath}: ${message}`,
            uri
          }]
        };
      }
    }
  };
}

