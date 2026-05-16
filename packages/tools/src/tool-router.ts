/**
 * The ToolRouter knows the registered tools, enforces per-agent scopes, decides
 * whether a call needs human approval, and (for ready calls) executes them.
 */
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./types";

export interface AgentLike {
  toolScopes: string[];
}

export type RouteDecision =
  | { status: "ready"; tool: ToolDefinition }
  | { status: "approval_required"; tool: ToolDefinition }
  | { status: "denied"; reason: string; tool?: ToolDefinition };

export class ToolRouter {
  private readonly index: Map<string, ToolDefinition>;

  constructor(private readonly tools: ToolDefinition[]) {
    this.index = new Map(tools.map((tool) => [tool.name, tool]));
  }

  list(): ToolDefinition[] {
    return [...this.tools];
  }

  /** Subset of tools an agent is allowed to see in its prompt. */
  toolsForAgent(agent: AgentLike): ToolDefinition[] {
    return this.tools.filter((tool) => agent.toolScopes.includes(tool.requiredScope));
  }

  route(agent: AgentLike, toolName: string): RouteDecision {
    const tool = this.index.get(toolName);
    if (!tool) {
      return { status: "denied", reason: `unknown tool ${toolName}` };
    }
    if (!agent.toolScopes.includes(tool.requiredScope)) {
      return { status: "denied", reason: `agent lacks scope ${tool.requiredScope}`, tool };
    }
    if (tool.sensitive) {
      return { status: "approval_required", tool };
    }
    return { status: "ready", tool };
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.index.get(toolName);
    if (!tool) return { ok: false, output: `unknown tool ${toolName}`, errorMessage: "unknown tool" };
    try {
      return await tool.execute(args, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, output: `error: ${message}`, errorMessage: message };
    }
  }
}
