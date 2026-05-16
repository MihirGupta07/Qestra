/**
 * Heartbeat orchestration. This is the only module that knows how the agent
 * runtime, the tool router, and the repository fit together. Called from:
 *   - POST /api/heartbeat (synchronous path, no Redis)
 *   - the BullMQ worker (queued path)
 *   - the API's setInterval auto-tick (if QESTRA_AUTO_HEARTBEAT_SECONDS > 0)
 *   - POST /api/approvals/:id/(approve|reject) to resume a paused execution
 */
import { AgentRuntime, type RuntimeAgent, type RuntimeEvent, type RuntimeOutcome } from "../../../../packages/agents/src/runtime";
import type { LLMProvider } from "../../../../packages/llm/src/provider";
import type { ToolRouter } from "../../../../packages/tools/src/tool-router";
import type { ApiConfig } from "../config";
import type {
  AgentDocument,
  ApprovalDocument,
  ExecutionDocument,
  ExecutionStatus,
  TaskDocument,
  ToolCallDocument
} from "../domain";
import { createLLMProviderFromKey, type CreateProviderInput } from "../llm/create-llm-provider";
import { decryptSecret } from "../security/secrets";
import { createId, nowIso, type OrchestratorRepository } from "../repositories/orchestrator-repository";

export interface HeartbeatDeps {
  repository: OrchestratorRepository;
  toolRouter: ToolRouter;
  config: ApiConfig;
}

export async function runHeartbeat(deps: HeartbeatDeps): Promise<void> {
  const { repository, toolRouter, config } = deps;

  const task = await repository.claimNextQueuedTask();
  if (!task) {
    await repository.appendEvent({
      title: "Heartbeat",
      detail: "No queued tasks were available."
    });
    return;
  }

  const agent = await repository.getAgent(task.assigneeAgentId);
  if (!agent || agent.status === "paused") {
    await repository.updateTaskStatus(task._id, "blocked");
    await repository.appendEvent({
      title: "Task blocked",
      detail: `${task.title} has no available agent.`,
      taskId: task._id
    });
    return;
  }

  if (agent.budgetUsedCents >= agent.budgetLimitCents) {
    await repository.setAgentStatus(agent._id, "paused");
    await repository.updateTaskStatus(task._id, "blocked");
    await repository.appendEvent({
      title: "Budget guard paused agent",
      detail: `${agent.name} reached its budget of ${agent.budgetLimitCents} cents.`,
      agentId: agent._id,
      taskId: task._id
    });
    return;
  }

  const llm = await resolveProvider(repository, config);
  const runtime = buildRuntime(llm, toolRouter, config);

  const executionId = createId("execution");
  const execution: ExecutionDocument = {
    _id: executionId,
    companyId: task.companyId,
    taskId: task._id,
    agentId: agent._id,
    status: "running",
    provider: llm.name,
    model: (await repository.getProviderSettings()).model,
    inputSummary: task.title,
    outputSummary: "",
    costCents: 0,
    stepsUsed: 0,
    messages: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  await repository.createExecution(execution);
  await repository.setAgentStatus(agent._id, "running");
  await repository.appendEvent({
    title: "Agent woke",
    detail: `${agent.name} locked ${task.title} for execution.`,
    taskId: task._id,
    agentId: agent._id,
    executionId
  });

  let outcome: RuntimeOutcome;
  try {
    outcome = await runtime.start({
      agent: toRuntimeAgent(agent),
      task: { id: task._id, title: task.title, goal: task.goal }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await failExecution(deps, execution, task, agent, errorMessage);
    return;
  }

  await applyOutcome(deps, execution, task, agent, outcome);
}

export async function resolveApprovalAndResume(
  deps: HeartbeatDeps,
  approvalId: string,
  decision: "approved" | "rejected"
): Promise<ApprovalDocument | undefined> {
  const { repository, toolRouter, config } = deps;
  const approval = await repository.getApproval(approvalId);
  if (!approval || approval.status !== "pending") return approval;

  await repository.setApprovalStatus(approvalId, decision);

  const execution = await repository.getExecution(approval.executionId);
  if (!execution) return approval;
  const agent = await repository.getAgent(execution.agentId);
  const task = await findTask(repository, approval.taskId);
  if (!agent || !task) return approval;

  await repository.updateToolCall(`toolcall:${execution.pendingApprovalToolCall?.callId ?? "unknown"}`, {});
  // mark the corresponding tool-call row using the callId we stored
  const callId = execution.pendingApprovalToolCall?.callId;
  if (callId) {
    await repository.updateToolCall(callId, {
      status: decision === "approved" ? "approved" : "rejected"
    });
  }

  await repository.appendAudit("user_local", "user", `approval.${decision}`, approval._id, {
    taskId: approval.taskId,
    executionId: approval.executionId
  });
  await repository.appendEvent({
    title: decision === "approved" ? "Approval granted" : "Approval rejected",
    detail:
      decision === "approved"
        ? "Execution resumed under human authorization."
        : "Action denied; agent will replan or fail.",
    taskId: approval.taskId,
    agentId: approval.requestedByAgentId,
    executionId: approval.executionId
  });

  const llm = await resolveProvider(repository, config);
  const runtime = buildRuntime(llm, toolRouter, config);

  let outcome: RuntimeOutcome;
  try {
    outcome = await runtime.resume({
      agent: toRuntimeAgent(agent),
      state: {
        messages: execution.messages,
        stepsUsed: execution.stepsUsed,
        pendingApprovalToolCall: execution.pendingApprovalToolCall
      },
      decision,
      executionId: execution._id
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await failExecution(deps, execution, task, agent, errorMessage);
    return approval;
  }

  await applyOutcome(deps, execution, task, agent, outcome);
  return approval;
}

// ---------------------------------------------------------------------------

async function applyOutcome(
  deps: HeartbeatDeps,
  execution: ExecutionDocument,
  task: TaskDocument,
  agent: AgentDocument,
  outcome: RuntimeOutcome
): Promise<void> {
  const { repository } = deps;
  let assistantTail = execution.outputSummary;

  // Persist each runtime event into tool_calls + events.
  for (const event of outcome.events) {
    if (event.kind === "assistant_message") {
      assistantTail = event.text;
    } else if (event.kind === "tool_call_pending_approval") {
      const toolCall: ToolCallDocument = {
        _id: event.callId,
        companyId: execution.companyId,
        executionId: execution._id,
        taskId: execution.taskId,
        agentId: execution.agentId,
        toolName: event.toolName,
        requestedScope: outcome.state.pendingApprovalToolCall?.requestedScope ?? "",
        sensitive: true,
        status: "approval_required",
        arguments: event.arguments,
        createdAt: nowIso()
      };
      await repository.addToolCall(toolCall);
      const approval: ApprovalDocument = {
        _id: createId("approval"),
        companyId: execution.companyId,
        taskId: execution.taskId,
        executionId: execution._id,
        requestedByAgentId: execution.agentId,
        title: `${agent.name} wants to run ${event.toolName}`,
        reason: `Arguments: ${truncateJson(event.arguments)}`,
        toolName: event.toolName,
        toolArguments: event.arguments,
        status: "pending",
        createdAt: nowIso()
      };
      await repository.createApproval(approval);
      await repository.appendEvent({
        title: "Approval required",
        detail: `${event.toolName} is sensitive; waiting for human approval.`,
        taskId: execution.taskId,
        agentId: execution.agentId,
        executionId: execution._id
      });
    } else if (event.kind === "tool_call_started") {
      const toolCall: ToolCallDocument = {
        _id: event.callId,
        companyId: execution.companyId,
        executionId: execution._id,
        taskId: execution.taskId,
        agentId: execution.agentId,
        toolName: event.toolName,
        requestedScope: "",
        sensitive: false,
        status: "proposed",
        arguments: event.arguments,
        createdAt: nowIso()
      };
      await repository.addToolCall(toolCall);
    } else if (event.kind === "tool_call_result") {
      await repository.updateToolCall(event.callId, {
        status: event.ok ? "executed" : "failed",
        output: event.output,
        errorMessage: event.errorMessage
      });
      await repository.appendEvent({
        title: `${event.toolName} ${event.ok ? "succeeded" : "failed"}`,
        detail: event.output.slice(0, 200),
        taskId: execution.taskId,
        agentId: execution.agentId,
        executionId: execution._id
      });
    } else if (event.kind === "tool_call_denied") {
      const toolCall: ToolCallDocument = {
        _id: event.callId,
        companyId: execution.companyId,
        executionId: execution._id,
        taskId: execution.taskId,
        agentId: execution.agentId,
        toolName: event.toolName,
        requestedScope: "",
        sensitive: false,
        status: "denied",
        arguments: {},
        errorMessage: event.reason,
        createdAt: nowIso()
      };
      await repository.addToolCall(toolCall);
    }
  }

  await repository.incrementAgentBudget(agent._id, outcome.costCents);
  const totalCostCents = execution.costCents + outcome.costCents;
  const newStatus: ExecutionStatus =
    outcome.status === "completed"
      ? "completed"
      : outcome.status === "waiting_for_approval"
        ? "waiting_for_approval"
        : outcome.status === "max_steps"
          ? "max_steps"
          : "failed";

  await repository.updateExecution(execution._id, {
    status: newStatus,
    outputSummary: assistantTail,
    costCents: totalCostCents,
    stepsUsed: outcome.state.stepsUsed,
    messages: outcome.state.messages,
    pendingApprovalToolCall: outcome.state.pendingApprovalToolCall,
    updatedAt: nowIso()
  });

  // Task status mirroring.
  if (outcome.status === "completed") {
    await repository.updateTaskStatus(execution.taskId, "done");
  } else if (outcome.status === "waiting_for_approval") {
    await repository.updateTaskStatus(execution.taskId, "blocked");
  } else if (outcome.status === "failed") {
    await repository.updateTaskStatus(execution.taskId, "failed");
  } else {
    await repository.updateTaskStatus(execution.taskId, "blocked");
  }

  // Free the agent again unless still busy on this task.
  if (outcome.status !== "waiting_for_approval") {
    const current = await repository.getAgent(agent._id);
    if (current && current.status !== "paused") {
      await repository.setAgentStatus(agent._id, "ready");
    }
  }

  await repository.appendAudit(agent._id, "agent", `execution.${outcome.status}`, execution._id, {
    taskId: execution.taskId,
    provider: execution.provider,
    costCents: outcome.costCents,
    stepsUsed: outcome.state.stepsUsed
  });
}

async function failExecution(
  deps: HeartbeatDeps,
  execution: ExecutionDocument,
  task: TaskDocument,
  agent: AgentDocument,
  errorMessage: string
): Promise<void> {
  await deps.repository.updateExecution(execution._id, {
    status: "failed",
    errorMessage,
    outputSummary: errorMessage,
    updatedAt: nowIso()
  });
  await deps.repository.updateTaskStatus(task._id, "failed");
  await deps.repository.setAgentStatus(agent._id, "ready");
  await deps.repository.appendEvent({
    title: "Execution failed",
    detail: errorMessage,
    taskId: task._id,
    agentId: agent._id,
    executionId: execution._id
  });
  await deps.repository.appendAudit(agent._id, "agent", "execution.failed", execution._id, {
    taskId: task._id,
    errorMessage
  });
}

async function resolveProvider(repository: OrchestratorRepository, config: ApiConfig): Promise<LLMProvider> {
  const settings = await repository.getProviderSettings();
  const apiKey = settings.encryptedApiKey ? decryptSecret(settings.encryptedApiKey, config.encryptionSecret) : undefined;
  const input: CreateProviderInput = {
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    apiKey,
    fallback: config
  };
  return createLLMProviderFromKey(input);
}

function buildRuntime(llm: LLMProvider, toolRouter: ToolRouter, config: ApiConfig): AgentRuntime {
  return new AgentRuntime(llm, toolRouter, { maxSteps: config.maxRuntimeSteps });
}

function toRuntimeAgent(agent: AgentDocument): RuntimeAgent {
  return {
    id: agent._id,
    companyId: agent.companyId,
    name: agent.name,
    role: agent.role,
    toolScopes: agent.toolScopes
  };
}

function truncateJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

async function findTask(repository: OrchestratorRepository, id: string): Promise<TaskDocument | undefined> {
  const snapshot = await repository.getSnapshot();
  return snapshot.tasks.find((task) => task._id === id);
}

// Re-export RuntimeEvent for callers that want to log it.
export type { RuntimeEvent };
