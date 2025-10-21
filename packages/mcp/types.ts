export type ServerInstance = import('./index').Server;

export interface MCPTextContentItem {
  type: 'text';
  text: string;
}

export interface MCPTextResponse {
  content: MCPTextContentItem[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ToolContext {
  server: ServerInstance;
}

export interface ResourceContext {
  server: ServerInstance;
}

export interface SearchDocument {
  id: string;
  name?: string;
  description?: string;
}

