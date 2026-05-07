import { AgentRuntime } from "../../../packages/agents/src/runtime";
import { MockLLMProvider } from "../../../packages/llm/src/provider";
import { ToolRouter } from "../../../packages/tools/src/tool-router";
import type { Agent, Task } from "../../../packages/shared/src/domain";

const runtime = new AgentRuntime(
  new MockLLMProvider(),
  new ToolRouter([
    {
      name: "audit_log.write",
      requiredScope: "audit:write",
      sensitive: false,
      execute: async (input) => input
    },
    {
      name: "shell.exec",
      requiredScope: "shell:scoped",
      sensitive: true,
      execute: async (input) => input
    }
  ])
);

export async function wakeAgent(agent: Agent, task: Task) {
  if (agent.budgetCents <= 0) {
    throw new Error(`Agent ${agent.id} has no execution budget.`);
  }

  return runtime.run({ agent, task });
}
