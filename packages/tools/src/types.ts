/**
 * Tool definitions live in this package because both the agent runtime and the
 * API server need to know the same names, schemas, and sensitivity flags.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the argument object. Passed through to the LLM. */
  parameters: Record<string, unknown>;
  /** RBAC scope the calling agent must hold. */
  requiredScope: string;
  /** Sensitive tools route through a human approval gate before executing. */
  sensitive: boolean;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export interface ToolExecutionContext {
  executionId: string;
  agentId: string;
  companyId: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  /** Compact string for feeding back to the LLM. */
  output: string;
  /** Optional structured payload persisted on the tool-call record. */
  data?: unknown;
  errorMessage?: string;
}

export function ok(output: string, data?: unknown): ToolExecutionResult {
  return { ok: true, output, data };
}

export function fail(errorMessage: string, data?: unknown): ToolExecutionResult {
  return { ok: false, output: `error: ${errorMessage}`, errorMessage, data };
}

export function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}
