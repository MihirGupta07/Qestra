import { InMemoryNotesStore, type NotesStore } from "../../../../packages/tools/src/notes-tool";
import type {
  AgentDocument,
  ApprovalDocument,
  AuditLogDocument,
  DashboardSnapshot,
  ExecutionDocument,
  ExecutionEventDocument,
  ProviderSettingsDocument,
  ProviderSettingsPublic,
  TaskDocument,
  ToolCallDocument
} from "../domain";
import {
  type AppendEventInput,
  createAuditLog,
  createId,
  defaultProviderSettings,
  nowIso,
  type OrchestratorRepository,
  publicProviderSettings,
  seedSnapshot,
  type CreateTaskInput,
  type UpsertProviderSettingsInput
} from "./orchestrator-repository";
import { encryptSecret, last4 } from "../security/secrets";

export class InMemoryOrchestratorRepository implements OrchestratorRepository {
  private snapshot = makeFreshSnapshot();
  private providerSettings = defaultProviderSettings(this.snapshot.company._id);
  private notes = new InMemoryNotesStore();

  async getSnapshot(): Promise<DashboardSnapshot> {
    return {
      ...structuredClone(this.snapshot),
      providerSettings: publicProviderSettings(this.providerSettings),
      notes: await this.notes.list()
    };
  }

  async createTask(input: CreateTaskInput): Promise<TaskDocument> {
    const fallbackAgent = this.snapshot.agents.find((agent) => agent.status !== "paused");
    const task: TaskDocument = {
      _id: createId("task"),
      companyId: this.snapshot.company._id,
      ticketId: createId("ticket"),
      title: input.title,
      goal: input.goal,
      assigneeAgentId: input.assigneeAgentId ?? fallbackAgent?._id ?? this.snapshot.agents[0]._id,
      status: "queued",
      priority: input.priority ?? 5,
      createdAt: nowIso()
    };

    this.snapshot.tasks.push(task);
    await this.appendEvent({
      title: "Task created",
      detail: task.title,
      taskId: task._id
    });
    return structuredClone(task);
  }

  async claimNextQueuedTask(): Promise<TaskDocument | undefined> {
    const candidate = [...this.snapshot.tasks]
      .filter((task) => task.status === "queued")
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))[0];
    if (!candidate) return undefined;
    candidate.status = "running";
    return structuredClone(candidate);
  }

  async updateTaskStatus(id: string, status: TaskDocument["status"]): Promise<void> {
    const task = this.snapshot.tasks.find((candidate) => candidate._id === id);
    if (task) task.status = status;
  }

  async getAgent(id: string): Promise<AgentDocument | undefined> {
    const agent = this.snapshot.agents.find((candidate) => candidate._id === id);
    return agent ? structuredClone(agent) : undefined;
  }

  async setAgentStatus(id: string, status: AgentDocument["status"]): Promise<void> {
    const agent = this.snapshot.agents.find((candidate) => candidate._id === id);
    if (agent) agent.status = status;
  }

  async incrementAgentBudget(id: string, costCents: number): Promise<void> {
    const agent = this.snapshot.agents.find((candidate) => candidate._id === id);
    if (!agent) return;
    agent.budgetUsedCents += costCents;
    if (agent.budgetUsedCents >= agent.budgetLimitCents) {
      agent.status = "paused";
    }
  }

  async createExecution(execution: ExecutionDocument): Promise<void> {
    this.snapshot.executions.unshift(structuredClone(execution));
  }

  async getExecution(id: string): Promise<ExecutionDocument | undefined> {
    const execution = this.snapshot.executions.find((candidate) => candidate._id === id);
    return execution ? structuredClone(execution) : undefined;
  }

  async updateExecution(id: string, patch: Partial<ExecutionDocument>): Promise<void> {
    const execution = this.snapshot.executions.find((candidate) => candidate._id === id);
    if (!execution) return;
    Object.assign(execution, patch);
  }

  async addToolCall(toolCall: ToolCallDocument): Promise<void> {
    this.snapshot.toolCalls.unshift(structuredClone(toolCall));
  }

  async updateToolCall(id: string, patch: Partial<ToolCallDocument>): Promise<void> {
    const toolCall = this.snapshot.toolCalls.find((candidate) => candidate._id === id);
    if (!toolCall) return;
    Object.assign(toolCall, patch);
  }

  async createApproval(approval: ApprovalDocument): Promise<void> {
    this.snapshot.approvals.unshift(structuredClone(approval));
  }

  async getApproval(id: string): Promise<ApprovalDocument | undefined> {
    const approval = this.snapshot.approvals.find((candidate) => candidate._id === id);
    return approval ? structuredClone(approval) : undefined;
  }

  async setApprovalStatus(id: string, status: ApprovalDocument["status"]): Promise<void> {
    const approval = this.snapshot.approvals.find((candidate) => candidate._id === id);
    if (approval) approval.status = status;
  }

  async appendEvent(input: AppendEventInput): Promise<void> {
    const event: ExecutionEventDocument = {
      _id: createId("event"),
      companyId: this.snapshot.company._id,
      taskId: input.taskId,
      agentId: input.agentId,
      executionId: input.executionId,
      title: input.title,
      detail: input.detail,
      costCents: input.costCents ?? 0,
      createdAt: nowIso()
    };
    this.snapshot.events.unshift(event);
    // Keep the tail bounded so the snapshot doesn't grow forever in long-running dev sessions.
    if (this.snapshot.events.length > 200) this.snapshot.events.length = 200;
  }

  async appendAudit(
    actorId: string,
    actorType: AuditLogDocument["actorType"],
    action: string,
    targetId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const previous = this.snapshot.auditLogs[0]?.hash;
    const log = createAuditLog(this.snapshot.company._id, actorId, actorType, action, targetId, previous, metadata);
    this.snapshot.auditLogs.unshift(log);
    if (this.snapshot.auditLogs.length > 200) this.snapshot.auditLogs.length = 200;
  }

  async resetDemoData(): Promise<DashboardSnapshot> {
    const preserved = this.providerSettings;
    this.snapshot = makeFreshSnapshot();
    this.providerSettings = { ...preserved, companyId: this.snapshot.company._id };
    // Clear in place so the toolRouter (which captured a reference at startup)
    // keeps writing to the same store.
    this.notes.clear();
    await this.appendAudit("user_local", "user", "demo.reset", this.snapshot.company._id, {
      preservedProviderSettings: true
    });
    return this.getSnapshot();
  }

  async getProviderSettings(): Promise<ProviderSettingsDocument> {
    return structuredClone(this.providerSettings);
  }

  async updateProviderSettings(
    input: UpsertProviderSettingsInput,
    encryptionSecret: string
  ): Promise<ProviderSettingsPublic> {
    const encryptedApiKey = input.apiKey
      ? encryptSecret(input.apiKey, encryptionSecret)
      : this.providerSettings.encryptedApiKey;
    this.providerSettings = {
      ...this.providerSettings,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? this.providerSettings.baseUrl,
      encryptedApiKey,
      apiKeyLast4: input.apiKey ? last4(input.apiKey) : this.providerSettings.apiKeyLast4,
      apiKeySet: Boolean(encryptedApiKey),
      updatedAt: nowIso()
    };
    await this.appendAudit("user_local", "user", "provider_settings.update", this.providerSettings._id, {
      provider: input.provider,
      model: input.model,
      baseUrl: this.providerSettings.baseUrl,
      apiKeySet: this.providerSettings.apiKeySet
    });
    return publicProviderSettings(this.providerSettings);
  }

  notesStore(): NotesStore {
    return this.notes;
  }
}

function makeFreshSnapshot(): Omit<DashboardSnapshot, "notes"> {
  return seedSnapshot();
}
