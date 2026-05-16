/**
 * Mongo implementation of the orchestrator repository.
 *
 * The hot-path query patterns intentionally mirror the in-memory repository so
 * the same heartbeat orchestrator drives both. Notes live in their own
 * collection so the `notes.*` tools survive restarts.
 */
import { MongoClient, type Collection, type Db } from "mongodb";
import type { NotesStore } from "../../../../packages/tools/src/notes-tool";
import type {
  AgentDocument,
  ApprovalDocument,
  AuditLogDocument,
  DashboardSnapshot,
  ExecutionDocument,
  ExecutionEventDocument,
  NoteDocument,
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

interface CompanyDocument {
  _id: string;
  name: string;
  monthlyBudgetCents: number;
}

export class MongoOrchestratorRepository implements OrchestratorRepository {
  private constructor(private readonly db: Db, private readonly companyId: string) {}

  static async connect(uri: string, dbName: string) {
    const client = new MongoClient(uri);
    await client.connect();
    const repository = new MongoOrchestratorRepository(client.db(dbName), "company_local");
    await repository.ensureIndexes();
    await repository.ensureSeedData();
    return repository;
  }

  async getSnapshot(): Promise<DashboardSnapshot> {
    const company = await this.companies.findOne({ _id: this.companyId });
    if (!company) throw new Error(`Missing company ${this.companyId}`);

    const [agents, tasks, approvals, events, executions, toolCalls, auditLogs, providerSettings, notes] = await Promise.all([
      this.agents.find({ companyId: this.companyId }).toArray(),
      this.tasks.find({ companyId: this.companyId }).sort({ priority: -1, createdAt: 1 }).toArray(),
      this.approvals.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.events.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.executions.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.toolCalls.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.auditLogs.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.getProviderSettings(),
      this.notesCollection.find({ companyId: this.companyId }).toArray()
    ]);

    return {
      company,
      agents,
      tasks,
      approvals,
      events,
      executions,
      toolCalls,
      auditLogs,
      providerSettings: publicProviderSettings(providerSettings),
      notes: notes.map((note) => ({ key: note.key, value: note.value }))
    };
  }

  async createTask(input: CreateTaskInput): Promise<TaskDocument> {
    const fallbackAgent = await this.agents.findOne({ companyId: this.companyId, status: { $ne: "paused" } });
    const task: TaskDocument = {
      _id: createId("task"),
      companyId: this.companyId,
      ticketId: createId("ticket"),
      title: input.title,
      goal: input.goal,
      assigneeAgentId: input.assigneeAgentId ?? fallbackAgent?._id ?? "agent_researcher",
      status: "queued",
      priority: input.priority ?? 5,
      createdAt: nowIso()
    };
    await this.tasks.insertOne(task);
    await this.appendEvent({ title: "Task created", detail: task.title, taskId: task._id });
    return task;
  }

  async claimNextQueuedTask(): Promise<TaskDocument | undefined> {
    const result = await this.tasks.findOneAndUpdate(
      { companyId: this.companyId, status: "queued" },
      { $set: { status: "running" } },
      { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" }
    );
    return result ?? undefined;
  }

  async updateTaskStatus(id: string, status: TaskDocument["status"]): Promise<void> {
    await this.tasks.updateOne({ _id: id }, { $set: { status } });
  }

  async getAgent(id: string): Promise<AgentDocument | undefined> {
    return (await this.agents.findOne({ _id: id })) ?? undefined;
  }

  async setAgentStatus(id: string, status: AgentDocument["status"]): Promise<void> {
    await this.agents.updateOne({ _id: id }, { $set: { status } });
  }

  async incrementAgentBudget(id: string, costCents: number): Promise<void> {
    const updated = await this.agents.findOneAndUpdate(
      { _id: id },
      { $inc: { budgetUsedCents: costCents } },
      { returnDocument: "after" }
    );
    if (updated && updated.budgetUsedCents >= updated.budgetLimitCents) {
      await this.agents.updateOne({ _id: id }, { $set: { status: "paused" } });
    }
  }

  async createExecution(execution: ExecutionDocument): Promise<void> {
    await this.executions.insertOne(execution);
  }

  async getExecution(id: string): Promise<ExecutionDocument | undefined> {
    return (await this.executions.findOne({ _id: id })) ?? undefined;
  }

  async updateExecution(id: string, patch: Partial<ExecutionDocument>): Promise<void> {
    // Mongo doesn't allow $set with undefined; strip those.
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) clean[key] = value;
    }
    if (Object.keys(clean).length === 0) return;
    await this.executions.updateOne({ _id: id }, { $set: clean });
  }

  async addToolCall(toolCall: ToolCallDocument): Promise<void> {
    await this.toolCalls.insertOne(toolCall);
  }

  async updateToolCall(id: string, patch: Partial<ToolCallDocument>): Promise<void> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) clean[key] = value;
    }
    if (Object.keys(clean).length === 0) return;
    await this.toolCalls.updateOne({ _id: id }, { $set: clean });
  }

  async createApproval(approval: ApprovalDocument): Promise<void> {
    await this.approvals.insertOne(approval);
  }

  async getApproval(id: string): Promise<ApprovalDocument | undefined> {
    return (await this.approvals.findOne({ _id: id })) ?? undefined;
  }

  async setApprovalStatus(id: string, status: ApprovalDocument["status"]): Promise<void> {
    await this.approvals.updateOne({ _id: id }, { $set: { status } });
  }

  async appendEvent(input: AppendEventInput): Promise<void> {
    const event: ExecutionEventDocument = {
      _id: createId("event"),
      companyId: this.companyId,
      taskId: input.taskId,
      agentId: input.agentId,
      executionId: input.executionId,
      title: input.title,
      detail: input.detail,
      costCents: input.costCents ?? 0,
      createdAt: nowIso()
    };
    await this.events.insertOne(event);
  }

  async appendAudit(
    actorId: string,
    actorType: AuditLogDocument["actorType"],
    action: string,
    targetId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const previous = await this.auditLogs.find({ companyId: this.companyId }).sort({ createdAt: -1 }).limit(1).next();
    await this.auditLogs.insertOne(
      createAuditLog(this.companyId, actorId, actorType, action, targetId, previous?.hash, metadata)
    );
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
      this.auditLogs.deleteMany({ companyId: this.companyId }),
      this.notesCollection.deleteMany({ companyId: this.companyId })
    ]);

    await Promise.all([
      this.companies.insertOne(seed.company),
      this.agents.insertMany(seed.agents),
      this.tasks.insertMany(seed.tasks),
      this.events.insertMany(seed.events),
      this.auditLogs.insertMany(seed.auditLogs),
      this.providerSettings.replaceOne({ _id: providerSettings._id }, providerSettings, { upsert: true })
    ]);
    await this.appendAudit("user_local", "user", "demo.reset", this.companyId, { preservedProviderSettings: true });
    return this.getSnapshot();
  }

  async getProviderSettings(): Promise<ProviderSettingsDocument> {
    const settings = await this.providerSettings.findOne({ companyId: this.companyId });
    if (settings) return settings;
    const defaults = defaultProviderSettings(this.companyId);
    await this.providerSettings.insertOne(defaults);
    return defaults;
  }

  async updateProviderSettings(
    input: UpsertProviderSettingsInput,
    encryptionSecret: string
  ): Promise<ProviderSettingsPublic> {
    const existing = await this.getProviderSettings();
    const encryptedApiKey = input.apiKey ? encryptSecret(input.apiKey, encryptionSecret) : existing.encryptedApiKey;
    const next: ProviderSettingsDocument = {
      ...existing,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      encryptedApiKey,
      apiKeyLast4: input.apiKey ? last4(input.apiKey) : existing.apiKeyLast4,
      apiKeySet: Boolean(encryptedApiKey),
      updatedAt: nowIso()
    };
    await this.providerSettings.replaceOne({ _id: next._id }, next, { upsert: true });
    await this.appendAudit("user_local", "user", "provider_settings.update", next._id, {
      provider: next.provider,
      model: next.model,
      baseUrl: next.baseUrl,
      apiKeySet: next.apiKeySet
    });
    return publicProviderSettings(next);
  }

  notesStore(): NotesStore {
    const collection = this.notesCollection;
    const companyId = this.companyId;
    return {
      async get(key) {
        const doc = await collection.findOne({ companyId, key });
        return doc?.value;
      },
      async set(key, value) {
        await collection.updateOne(
          { companyId, key },
          { $set: { companyId, key, value, updatedAt: nowIso() }, $setOnInsert: { _id: createId("note") } },
          { upsert: true }
        );
      },
      async list() {
        const all = await collection.find({ companyId }).toArray();
        return all.map((doc) => ({ key: doc.key, value: doc.value }));
      },
      async delete(key) {
        await collection.deleteOne({ companyId, key });
      }
    };
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
      this.providerSettings.createIndex({ companyId: 1 }, { unique: true }),
      this.notesCollection.createIndex({ companyId: 1, key: 1 }, { unique: true })
    ]);
  }

  private async ensureSeedData() {
    const existing = await this.companies.findOne({ _id: this.companyId });
    if (existing) return;
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
  private get toolCalls(): Collection<ToolCallDocument> {
    return this.db.collection<ToolCallDocument>("tool_calls");
  }
  private get auditLogs(): Collection<AuditLogDocument> {
    return this.db.collection<AuditLogDocument>("audit_logs");
  }
  private get providerSettings(): Collection<ProviderSettingsDocument> {
    return this.db.collection<ProviderSettingsDocument>("provider_settings");
  }
  private get notesCollection(): Collection<NoteDocument> {
    return this.db.collection<NoteDocument>("notes");
  }
}
