export type McpToolSource =
  | "server"
  | "local";

export interface McpToolDefinition {
  name: string;

  description?: string;

  inputSchema: Record<
    string,
    unknown
  >;

  source: McpToolSource;

  enabled: boolean;

  /**
   * Business/domain categories in which
   * this tool is useful.
   *
   * Example:
   * planets ->
   * ["foundation", "career", "finance", "marriage"]
   */
  categories: string[];
}

export interface McpToolCallInput {
  toolName: string;

  arguments?: Record<string, unknown>;

  signal?: AbortSignal;
}

export interface McpToolCallResult {
  toolName: string;

  success: boolean;

  content: unknown[];

  isError?: boolean;

  executionTimeMs: number;

  error?: string;
}

export interface McpClientOptions {
  serverUrl: string;

  apiKey: string;

  timeoutMs: number;

  clientName: string;

  clientVersion: string;
}

export interface McpConnectionState {
  connected: boolean;

  serverName?: string;

  serverVersion?: string;

  protocolVersion?: string;
}