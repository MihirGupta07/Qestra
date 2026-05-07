import type { Agent, ToolCall } from "../../shared/src/domain";

export interface ToolDefinition {
  name: string;
  requiredScope: string;
  sensitive: boolean;
  execute(input: unknown): Promise<unknown>;
}

export interface ToolRouteResult {
  status: "ready" | "approval_required" | "denied";
  toolCall: ToolCall;
}

export class ToolRouter {
  constructor(private readonly tools: ToolDefinition[]) {}

  route(agent: Agent, toolName: string, executionId: string): ToolRouteResult {
    const tool = this.tools.find((candidate) => candidate.name === toolName);

    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const hasScope = agent.toolScopes.includes(tool.requiredScope);
    const toolCall: ToolCall = {
      id: crypto.randomUUID(),
      executionId,
      toolName,
      requestedScope: tool.requiredScope,
      status: "proposed"
    };

    if (!hasScope) {
      return { status: "denied", toolCall };
    }

    if (tool.sensitive) {
      return { status: "approval_required", toolCall };
    }

    return { status: "ready", toolCall };
  }
}
