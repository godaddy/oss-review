import type { GetPromptResult, PromptArgsRawShape } from '@modelcontextprotocol/sdk/dist/esm/types.js';
import type { ConfigInstance } from '../config/index.ts';

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
  config: ConfigInstance;
}

export interface ResourceContext {
  server: ServerInstance;
  config: ConfigInstance;
}

export interface SearchDocument {
  id: string;
  name?: string;
  description?: string;
}

/**
 * Context provided to prompt factories when they are initialised.
 */
export interface PromptContext {
  /** Active MCP server instance. */
  server: ServerInstance;
  /** Configuration instance supplying instructions and metadata. */
  config: ConfigInstance;
}

/**
 * Schema describing the arguments accepted by a prompt definition.
 */
/**
 * Executor signature responsible for generating prompt messages.
 */
export type PromptExecutor = (args: Record<string, unknown>, extra?: unknown) => Promise<GetPromptResult>;

/**
 * Metadata and implementation required to register a prompt with the MCP server.
 */
export interface PromptDefinition {
  /** Human friendly title for the prompt. */
  title: string;
  /** Brief description surfaced to clients. */
  description: string;
  /** Optional schema describing accepted arguments. */
  argsSchema?: PromptArgsRawShape;
  /** Execution handler returning a formatted MCP prompt response. */
  exec: PromptExecutor;
}

/**
 * Registry of prompt definitions keyed by their registration name.
 */
export type Prompts = Record<string, PromptDefinition>;

