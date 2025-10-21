import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResourceContext } from '../types.ts';

/**
 * Create example entries resource definition (boilerplate).
 *
 * Exposes a static list() and read() for demonstration purposes.
 */
export function entries(_config: ResourceContext) {
  return {
    title: 'Entries',
    description: 'Access entries as resources (boilerplate).',
    template: new ResourceTemplate('{protocol}://{host}/{path}', {
      /**
       * List available resources.
       */
      list: async function listResources() {
        return { resources: [{
          uri: 'oss-review://v0/example',
          name: 'example',
          title: 'Example',
          mimeType: 'text/markdown',
          description: 'Example entry'
        }] };
      }
    }),
    /**
     * Read a given resource URI and return markdown content.
     */
    async read(request: { params: { uri: string } }) {
      return {
        contents: [{
          mimeType: 'text/markdown',
          text: `# ${request.params.uri}\n\nExample resource content.`,
          uri: request.params.uri
        }]
      };
    }
  };
}

