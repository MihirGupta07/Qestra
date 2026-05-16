import { MongoClient, type Collection, type Db } from "mongodb";
import type {
  AgentDocument,
  AuditLogDocument,
  ApprovalDocument,
  DashboardSnapshot,
  ExecutionDocument,
  ExecutionEventDocument,
  ProviderSettingsDocument,
  ProviderSettingsPublic,
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
import { encryptSecret, last4 } from "../security/secrets";

interface CompanyDocument {
  _id: string;
  name: string;
  monthlyBudgetCents: number;
}

export class MongoOrchestratorRepository implements OrchestratorRepository {
  private constructor(
    private readonly db: Db,
    private readonly companyId: string
  ) {}

  static async connect(uri: string, dbName: string) {
    const client = new MongoClient(uri);
    await client.connect();
    const repository = new MongoOrchestratorRepository(client.db(dbName), "company_acme");
    await repository.ensureIndexes();
    await repository.ensureSeedData();
    return repository;
  }

  async getSnapshot(): Promise<DashboardSnapshot> {
    const company = await this.companies.findOne({ _id: this.companyId });

    if (!company) {
      throw new Error(`Missing company ${this.companyId}`);
    }

    const [agents, tasks, approvals, events, executions, toolCalls, auditLogs, providerSettings] = await Promise.all([
      this.agents.find({ companyId: this.companyId }).toArray(),
      this.tasks.find({ companyId: this.companyId }).sort({ priority: -1, createdAt: 1 }).toArray(),
      this.approvals.find({ companyId: this.companyId }).sort({ createdAt: -1 }).toArray(),
      this.events.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.executions.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.toolCalls.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.auditLogs.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.getProviderSettings()
    ]);

    return { company, agents, tasks, approvals, events, executions, toolCalls, auditLogs, providerSettings: publicProviderSettings(providerSettings) };
  }

  async createTask(input: CreateTaskInput): Promise<TaskDocument> {
    const fallbackAgent = await this.agents.findOne({ companyId: this.companyId, status: { $ne: "paused" } });
    const task: TaskDocument = {
      _id: createId("task"),
      companyId: this.companyId,
      ticketId: createId("ticket"),
      title: input.title,
      goal: input.goal,
      assigneeAgentId: input.assigneeAgentId ?? fallbackAgent?._id ?? "agent_cto",
      status: "queued",
      priority: input.priority ?? 5,
      createdAt: nowIso()
    };

    await this.tasks.insertOne(task);
    await this.appendEvent({
      title: "Task created",
      detail: `${task.title} entered the ticket-backed queue.`,
      taskId: task._id
    });

    return task;
  }

  async runHeartbeat(llm?: LLMProvider): Promise<DashboardSnapshot> {
    const task = await this.tasks.findOneAndUpdate(
      { companyId: this.companyId, status: "queued" },
      { $set: { status: "running" } },
      { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" }
    );

    if (!task) {
      await this.appendEvent({
        title: "Heartbeat completed",
        detail: "No queued tasks were available for assignment."
      });
      return this.getSnapshot();
    }

    const agent = await this.agents.findOne({ _id: task.assigneeAgentId, companyId: this.companyId });
    if (!agent || agent.status === "paused") {
      await this.tasks.updateOne({ _id: task._id }, { $set: { status: "blocked" } });
      await this.appendEvent({
        title: "Task blocked",
        detail: `${task.title} has no available agent.`,
        taskId: task._id
      });
      return this.getSnapshot();
    }

    const costCents = 125 + Math.floor(Math.random() * 350);
    const executionId = createId("execution");
    const llmResult = await llm?.generate({
      system: `You are ${agent.name}. Plan one governed next action and respect approval gates.`,
      messages: [{ role: "user", content: `${task.title}\nGoal: ${task.goal}` }],
      maxTokens: 500
    });
    const executionCostCents = llmResult?.costCents ?? costCents;
    const execution: ExecutionDocument = {
      _id: executionId,
      companyId: task.companyId,
      taskId: task._id,
      agentId: agent._id,
      status: "running",
      provider: llm?.name ?? "mock",
      inputSummary: task.title,
      outputSummary: llmResult?.content ?? `Planned governed action for ${task.title}.`,
      costCents: executionCostCents,
      createdAt: nowIso()
    };
    await this.agents.updateOne(
      { _id: agent._id },
      { $set: { status: "running" }, $inc: { budgetUsedCents: executionCostCents } }
    );
    await this.executions.insertOne(execution);
    await this.appendEvent({
      title: "Agent woke",
      detail: `${agent.name} locked ${task.title} for execution.`,
      taskId: task._id,
      agentId: agent._id
    });

    if (requiresApproval(task)) {
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

      await Promise.all([
        this.executions.updateOne({ _id: executionId }, { $set: { status: "waiting_for_approval" } }),
        this.tasks.updateOne({ _id: task._id }, { $set: { status: "blocked" } }),
        this.approvals.insertOne(approval),
        this.toolCalls.insertOne({
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
        }),
        this.appendEvent({
          title: "Approval required",
          detail: "Execution paused until a human resolves the governance request.",
          taskId: task._id,
          agentId: agent._id,
          costCents: executionCostCents
        })
      ]);
    } else {
      await Promise.all([
        this.executions.updateOne({ _id: executionId }, { $set: { status: "completed" } }),
        this.tasks.updateOne({ _id: task._id }, { $set: { status: "done" } }),
        this.toolCalls.insertOne({
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
        }),
        this.appendEvent({
          title: "Execution completed",
          detail: `${agent.name} completed the task and wrote an audit event.`,
          taskId: task._id,
          agentId: agent._id,
          costCents: executionCostCents
        })
      ]);
    }

    await this.agents.updateOne({ _id: agent._id }, { $set: { status: "ready" } });
    await this.appendAudit(agent._id, "agent", "execution.run", executionId, {
      taskId: task._id,
      provider: execution.provider
    });
    return this.getSnapshot();
  }

  async resolveApproval(id: string, status: "approved" | "rejected"): Promise<ApprovalDocument | undefined> {
    const approval = await this.approvals.findOneAndUpdate(
      { _id: id, companyId: this.companyId },
      { $set: { status } },
      { returnDocument: "after" }
    );

    if (!approval) return undefined;

    await Promise.all([
      this.executions.updateOne({ _id: approval.executionId }, { $set: { status: status === "approved" ? "completed" : "failed" } }),
      this.toolCalls.updateOne({ executionId: approval.executionId }, { $set: { status: status === "approved" ? "approved" : "rejected" } }),
      this.tasks.updateOne({ _id: approval.taskId }, { $set: { status: status === "approved" ? "done" : "queued" } }),
      this.appendEvent({
        title: status === "approved" ? "Approval granted" : "Approval rejected",
        detail:
          status === "approved"
            ? "The blocked execution resumed and completed under human authorization."
            : "The action was denied and the task returned to the queue for replanning.",
        taskId: approval.taskId,
        agentId: approval.requestedByAgentId
      })
    ]);
    await this.appendAudit("user_local", "user", `approval.${status}`, approval._id, {
      taskId: approval.taskId,
      executionId: approval.executionId
    });

    return approval;
  }

  async resetDemoData(): Promise<DashboardSnapshot> {
    const providerSettings = await this.getProviderSettings();
    const seed = seedSnapshot();

    await Promise.all([
      this.companies.deleteMany({ _id: this.companyId }),
      this.agents.deleteMany({ companyId: this.companyId }),
      this.tasks.deleteMany({ companyId: this.companyId }),
      this.approvals.deleteMany({ companyId: this.companyId }),
      this.events.deleteMany({ companyId: this.companyId }),
      this.executions.deleteMany({ companyId: this.companyId }),
      this.toolCalls.deleteMany({ companyId: this.companyId }),
      this.auditLogs.deleteMany({ companyId: this.companyId })
    ]);

    await Promise.all([
      this.companies.insertOne(seed.company),
      this.agents.insertMany(seed.agents),
      this.tasks.insertMany(seed.tasks),
      this.events.insertMany(seed.events),
      this.auditLogs.insertMany(seed.auditLogs),
      this.providerSettings.replaceOne({ _id: providerSettings._id }, providerSettings, { upsert: true })
    ]);
    await this.appendAudit("user_local", "user", "demo.reset", this.companyId, {
      preservedProviderSettings: true
    });

    return this.getSnapshot();
  }

  async getProviderSettings(): Promise<ProviderSettingsDocument> {
    const settings = await this.providerSettings.findOne({ companyId: this.companyId });

    if (settings) {
      return settings;
    }

    const defaults = defaultProviderSettings(this.companyId);
    await this.providerSettings.insertOne(defaults);
    return defaults;
  }

  async updateProviderSettings(input: UpsertProviderSettingsInput, encryptionSecret: string): Promise<ProviderSettingsPublic> {
    const existing = await this.getProviderSettings();
    const next: ProviderSettingsDocument = {
      ...existing,
      provider: input.provider,
      model: input.model,
      encryptedApiKey: input.apiKey ? encryptSecret(input.apiKey, encryptionSecret) : existing.encryptedApiKey,
      apiKeyLast4: input.apiKey ? last4(input.apiKey) : existing.apiKeyLast4,
      apiKeySet: Boolean(input.apiKey || existing.encryptedApiKey),
      updatedAt: nowIso()
    };

    await this.providerSettings.replaceOne({ _id: next._id }, next, { upsert: true });
    await this.appendAudit("user_local", "user", "provider_settings.update", next._id, {
      provider: next.provider,
      model: next.model,
      apiKeySet: next.apiKeySet
    });

    return publicProviderSettings(next);
  }

  private async ensureIndexes() {
    await Promise.all([
      this.tasks.createIndex({ companyId: 1, status: 1, priority: -1, createdAt: 1 }),
      this.approvals.createIndex({ companyId: 1, status: 1, createdAt: -1 }),
      this.events.createIndex({ companyId: 1, createdAt: -1 }),
      this.agents.createIndex({ companyId: 1, status: 1 }),
      this.executions.createIndex({ companyId: 1, taskId: 1, createdAt: -1 }),
      this.toolCalls.createIndex({ companyId: 1, executionId: 1, createdAt: -1 }),
      this.auditLogs.createIndex({ companyId: 1, createdAt: -1 }),
      this.providerSettings.createIndex({ companyId: 1 }, { unique: true })
    ]);
  }

  private async ensureSeedData() {
    const existingCompany = await this.companies.findOne({ _id: this.companyId });
    if (existingCompany) return;

    const seed = seedSnapshot();
    await Promise.all([
      this.companies.insertOne(seed.company),
      this.agents.insertMany(seed.agents),
      this.tasks.insertMany(seed.tasks),
      this.events.insertMany(seed.events),
      this.auditLogs.insertMany(seed.auditLogs),
      this.providerSettings.insertOne(defaultProviderSettings(this.companyId))
    ]);
  }

  private async appendEvent(input: {
    title: string;
    detail: string;
    taskId?: string;
    agentId?: string;
    costCents?: number;
  }) {
    const event: ExecutionEventDocument = {
      _id: createId("event"),
      companyId: this.companyId,
      taskId: input.taskId,
      agentId: input.agentId,
      title: input.title,
      detail: input.detail,
      costCents: input.costCents ?? 0,
      createdAt: nowIso()
    };

    await this.events.insertOne(event);
  }

  private async appendAudit(
    actorId: string,
    actorType: AuditLogDocument["actorType"],
    action: string,
    targetId: string,
    metadata: Record<string, unknown>
  ) {
    const previous = await this.auditLogs.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(1).next();
    await this.auditLogs.insertOne(createAuditLog(this.companyId, actorId, actorType, action, targetId, previous?.hash, metadata));
  }

  private get companies(): Collection<CompanyDocument> {
    return this.db.collection<CompanyDocument>("companies");
  }

  private get agents(): Collection<AgentDocument> {
    return this.db.collection<AgentDocument>("agents");
  }

  private get tasks(): Collection<TaskDocument> {
    return this.db.collection<TaskDocument>("tasks");
  }

  private get approvals(): Collection<ApprovalDocument> {
    return this.db.collection<ApprovalDocument>("approvals");
  }

  private get events(): Collection<ExecutionEventDocument> {
    return this.db.collection<ExecutionEventDocument>("execution_events");
  }

  private get executions(): Collection<ExecutionDocument> {
    return this.db.collection<ExecutionDocument>("executions");
  }

  private get toolCalls(): Collection<DashboardSnapshot["toolCalls"][number]> {
    return this.db.collection<DashboardSnapshot["toolCalls"][number]>("tool_calls");
  }

  private get auditLogs(): Collection<AuditLogDocument> {
    return this.db.collection<AuditLogDocument>("audit_logs");
  }

  private get providerSettings(): Collection<ProviderSettingsDocument> {
    return this.db.collection<ProviderSettingsDocument>("provider_settings");
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
