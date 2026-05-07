import type { Agent, Execution, Task } from "../../shared/src/domain";
import type { LLMProvider } from "../../llm/src/provider";
import type { ToolRouter } from "../../tools/src/tool-router";

export interface AgentRuntimeInput {
  agent: Agent;
  task: Task;
}

export interface AgentRuntimeResult {
  execution: Execution;
  nextState: "completed" | "waiting_for_approval" | "failed";
}

export class AgentRuntime {
  constructor(
    private readonly llm: LLMProvider,
    private readonly toolRouter: ToolRouter
  ) {}

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    const execution: Execution = {
      id: crypto.randomUUID(),
      companyId: input.task.companyId,
      taskId: input.task.id,
      agentId: input.agent.id,
      status: "running",
      inputSummary: input.task.title,
      costCents: 0
    };

    const response = await this.llm.generate({
      system: `You are ${input.agent.name}. Work inside governance limits.`,
      messages: [{ role: "user", content: input.task.title }]
    });

    execution.costCents += response.costCents;
    execution.outputSummary = response.content;

    const route = this.toolRouter.route(input.agent, "audit_log.write", execution.id);

    if (route.status === "approval_required") {
      execution.status = "waiting_for_approval";
      return { execution, nextState: "waiting_for_approval" };
    }

    if (route.status === "denied") {
      execution.status = "failed";
      return { execution, nextState: "failed" };
    }

    execution.status = "completed";
    return { execution, nextState: "completed" };
  }
}
