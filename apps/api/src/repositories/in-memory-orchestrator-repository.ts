import type {
  AuditLogDocument,
  ApprovalDocument,
  DashboardSnapshot,
  ExecutionDocument,
  ExecutionEventDocument,
  TaskDocument
} from "../domain";
import {
  type CreateTaskInput,
  createAuditLog,
  createId,
  defaultProviderSettings,
  nowIso,
  type OrchestratorRepository,
  publicProviderSettings,
  seedSnapshot,
  type UpsertProviderSettingsInput
} from "./orchestrator-repository";
import type { LLMProvider } from "../../../../packages/llm/src/provider";
import type { ProviderSettingsDocument, ProviderSettingsPublic } from "../domain";
import { encryptSecret, last4 } from "../security/secrets";

export class InMemoryOrchestratorRepository implements OrchestratorRepository {
  private snapshot = seedSnapshot();
  private providerSettings = defaultProviderSettings(this.snapshot.company._id);

  async getSnapshot(): Promise<DashboardSnapshot> {
    return structuredClone({
      ...this.snapshot,
      providerSettings: publicProviderSettings(this.providerSettings)
    });
  }

  async createTask(input: CreateTaskInput): Promise<TaskDocument> {
    const fallbackAgent = this.snapshot.agents.find((agent) => agent.status !== "paused");
    const task: TaskDocument = {
      _id: createId("task"),
      companyId: this.snapshot.company._id,
      ticketId: createId("ticket"),
      title: input.title,
      goal: input.goal,
      assigneeAgentId: input.assigneeAgentId ?? fallbackAgent?._id ?? "agent_cto",
      status: "queued",
      priority: input.priority ?? 5,
      createdAt: nowIso()
    };

    this.snapshot.tasks.push(task);
    this.appendEvent({
      title: "Task created",
      detail: `${task.title} entered the ticket-backed queue.`,
      taskId: task._id
    });

    return structuredClone(task);
  }

  async runHeartbeat(llm?: LLMProvider): Promise<DashboardSnapshot> {
    const task = this.snapshot.tasks
      .filter((candidate) => candidate.status === "queued")
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))[0];

    if (!task) {
      this.appendEvent({
        title: "Heartbeat completed",
        detail: "No queued tasks were available for assignment."
      });
      return this.getSnapshot();
    }

    const agent = this.snapshot.agents.find((candidate) => candidate._id === task.assigneeAgentId);
    if (!agent || agent.status === "paused") {
      task.status = "blocked";
      this.appendEvent({
        title: "Task blocked",
        detail: `${task.title} has no available agent.`,
        taskId: task._id
      });
      return this.getSnapshot();
    }

    if (agent.budgetUsedCents >= agent.budgetLimitCents) {
      agent.status = "paused";
      task.status = "blocked";
      this.appendEvent({
        title: "Budget guard paused agent",
        detail: `${agent.name} reached its configured execution budget.`,
        taskId: task._id,
        agentId: agent._id
      });
      return this.getSnapshot();
    }

    task.status = "running";
    agent.status = "running";
    const executionId = createId("execution");
    const llmResult = await llm?.generate({
      system: `You are ${agent.name}. Plan one governed next action and respect approval gates.`,
      messages: [{ role: "user", content: `${task.title}\nGoal: ${task.goal}` }],
      maxTokens: 500
    });
    const costCents = llmResult?.costCents ?? 125 + Math.floor(Math.random() * 350);
    agent.budgetUsedCents += costCents;
    const execution: ExecutionDocument = {
      _id: executionId,
      companyId: task.companyId,
      taskId: task._id,
      agentId: agent._id,
      status: "running",
      provider: llm?.name ?? "mock",
      inputSummary: task.title,
      outputSummary: llmResult?.content ?? `Planned governed action for ${task.title}.`,
      costCents,
      createdAt: nowIso()
    };
    this.snapshot.executions.push(execution);

    this.appendEvent({
      title: "Agent woke",
      detail: `${agent.name} locked ${task.title} for execution.`,
      taskId: task._id,
      agentId: agent._id
    });

    if (requiresApproval(task)) {
      task.status = "blocked";
      execution.status = "waiting_for_approval";
      const approval: ApprovalDocument = {
        _id: createId("approval"),
        companyId: task.companyId,
        taskId: task._id,
        executionId,
        requestedByAgentId: agent._id,
        title: "Sensitive tool call requested",
        reason: `${agent.name} wants permission to continue a protected action for ${task.title}.`,
        status: "pending",
        createdAt: nowIso()
      };
      this.snapshot.toolCalls.push({
        _id: createId("toolcall"),
        companyId: task.companyId,
        executionId,
        taskId: task._id,
        agentId: agent._id,
        toolName: inferToolName(task),
        requestedScope: inferScope(task),
        sensitive: true,
        status: "approval_required",
        createdAt: nowIso()
      });
      this.snapshot.approvals.push(approval);
      this.appendEvent({
        title: "Approval required",
        detail: "Execution paused until a human resolves the governance request.",
        taskId: task._id,
        agentId: agent._id,
        costCents
      });
    } else {
      task.status = "done";
      execution.status = "completed";
      this.snapshot.toolCalls.push({
        _id: createId("toolcall"),
        companyId: task.companyId,
        executionId,
        taskId: task._id,
        agentId: agent._id,
        toolName: "audit_log.write",
        requestedScope: "audit:write",
        sensitive: false,
        status: "executed",
        createdAt: nowIso()
      });
      this.appendEvent({
        title: "Execution completed",
        detail: `${agent.name} completed the task and wrote an audit event.`,
        taskId: task._id,
        agentId: agent._id,
        costCents
      });
    }

    agent.status = "ready";
    this.appendAudit(agent._id, "agent", "execution.run", executionId, {
      taskId: task._id,
      status: execution.status,
      provider: execution.provider
    });
    return this.getSnapshot();
  }

  async resolveApproval(id: string, status: "approved" | "rejected"): Promise<ApprovalDocument | undefined> {
    const approval = this.snapshot.approvals.find((candidate) => candidate._id === id);
    if (!approval) return undefined;

    approval.status = status;
    const task = this.snapshot.tasks.find((candidate) => candidate._id === approval.taskId);

    if (task) {
      task.status = status === "approved" ? "done" : "queued";
    }

    const execution = this.snapshot.executions.find((candidate) => candidate._id === approval.executionId);
    if (execution) {
      execution.status = status === "approved" ? "completed" : "failed";
    }

    const toolCall = this.snapshot.toolCalls.find((candidate) => candidate.executionId === approval.executionId);
    if (toolCall) {
      toolCall.status = status === "approved" ? "approved" : "rejected";
    }

    this.appendEvent({
      title: status === "approved" ? "Approval granted" : "Approval rejected",
      detail:
        status === "approved"
          ? "The blocked execution resumed and completed under human authorization."
          : "The action was denied and the task returned to the queue for replanning.",
      taskId: task?._id,
      agentId: approval.requestedByAgentId
    });

    this.appendAudit("user_local", "user", `approval.${status}`, approval._id, {
      taskId: approval.taskId,
      executionId: approval.executionId
    });

    return structuredClone(approval);
  }

  async resetDemoData(): Promise<DashboardSnapshot> {
    const existingProviderSettings = this.providerSettings;
    this.snapshot = seedSnapshot();
    this.providerSettings = {
      ...existingProviderSettings,
      companyId: this.snapshot.company._id
    };
    this.appendAudit("user_local", "user", "demo.reset", this.snapshot.company._id, {
      preservedProviderSettings: true
    });

    return this.getSnapshot();
  }

  async getProviderSettings(): Promise<ProviderSettingsDocument> {
    return structuredClone(this.providerSettings);
  }

  async updateProviderSettings(input: UpsertProviderSettingsInput, encryptionSecret: string): Promise<ProviderSettingsPublic> {
    this.providerSettings = {
      ...this.providerSettings,
      provider: input.provider,
      model: input.model,
      encryptedApiKey: input.apiKey ? encryptSecret(input.apiKey, encryptionSecret) : this.providerSettings.encryptedApiKey,
      apiKeyLast4: input.apiKey ? last4(input.apiKey) : this.providerSettings.apiKeyLast4,
      apiKeySet: Boolean(input.apiKey || this.providerSettings.encryptedApiKey),
      updatedAt: nowIso()
    };

    this.appendAudit("user_local", "user", "provider_settings.update", this.providerSettings._id, {
      provider: input.provider,
      model: input.model,
      apiKeySet: this.providerSettings.apiKeySet
    });

    return publicProviderSettings(this.providerSettings);
  }

  private appendEvent(input: {
    title: string;
    detail: string;
    taskId?: string;
    agentId?: string;
    costCents?: number;
  }) {
    const event: ExecutionEventDocument = {
      _id: createId("event"),
      companyId: this.snapshot.company._id,
      taskId: input.taskId,
      agentId: input.agentId,
      title: input.title,
      detail: input.detail,
      costCents: input.costCents ?? 0,
      createdAt: nowIso()
    };

    this.snapshot.events.push(event);
  }

  private appendAudit(
    actorId: string,
    actorType: AuditLogDocument["actorType"],
    action: string,
    targetId: string,
    metadata: Record<string, unknown>
  ) {
    const previousHash = this.snapshot.auditLogs.at(-1)?.hash;
    this.snapshot.auditLogs.push(createAuditLog(this.snapshot.company._id, actorId, actorType, action, targetId, previousHash, metadata));
  }
}

function requiresApproval(task: TaskDocument) {
  const text = `${task.title} ${task.goal}`.toLowerCase();
  return text.includes("approval") || text.includes("deploy") || text.includes("shell") || text.includes("delete");
}

function inferToolName(task: TaskDocument) {
  const text = `${task.title} ${task.goal}`.toLowerCase();
  if (text.includes("shell")) return "shell.exec";
  if (text.includes("deploy")) return "deployment.promote";
  if (text.includes("delete")) return "data.delete";
  return "approval.request";
}

function inferScope(task: TaskDocument) {
  const toolName = inferToolName(task);
  if (toolName === "shell.exec") return "shell:scoped";
  if (toolName === "deployment.promote") return "deploy:write";
  if (toolName === "data.delete") return "data:delete";
  return "approval:write";
}
