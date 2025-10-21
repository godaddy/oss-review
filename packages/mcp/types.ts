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
}

export interface ResourceContext {
}

export interface SearchDocument {
  id: string;
  name?: string;
  description?: string;
}

