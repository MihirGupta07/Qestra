/**
 * The repository hides storage. Two implementations exist (in-memory + Mongo);
 * the orchestrator/heartbeat module uses only this interface so the same loop
 * runs against either backend.
 */
import { createHash } from "node:crypto";
import type { NotesStore } from "../../../../packages/tools/src/notes-tool";
import type {
  AgentDocument,
  ApprovalDocument,
  AuditLogDocument,
  DashboardSnapshot,
  ExecutionDocument,
  ExecutionEventDocument,
  LLMProviderName,
  ProviderSettingsDocument,
  ProviderSettingsPublic,
  TaskDocument,
  ToolCallDocument
} from "../domain";

export interface CreateTaskInput {
  title: string;
  goal: string;
  assigneeAgentId?: string;
  priority?: number;
}

export interface UpsertProviderSettingsInput {
  provider: LLMProviderName;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface AppendEventInput {
  title: string;
  detail: string;
  taskId?: string;
  agentId?: string;
  executionId?: string;
  costCents?: number;
}

export interface OrchestratorRepository {
  // ---- snapshot for the dashboard ----
  getSnapshot(): Promise<DashboardSnapshot>;

  // ---- tasks ----
  createTask(input: CreateTaskInput): Promise<TaskDocument>;
  /** Atomically claim the next queued task (highest priority, oldest). */
  claimNextQueuedTask(): Promise<TaskDocument | undefined>;
  updateTaskStatus(id: string, status: TaskDocument["status"]): Promise<void>;

  // ---- agents ----
  getAgent(id: string): Promise<AgentDocument | undefined>;
  setAgentStatus(id: string, status: AgentDocument["status"]): Promise<void>;
  incrementAgentBudget(id: string, costCents: number): Promise<void>;

  // ---- executions ----
  createExecution(execution: ExecutionDocument): Promise<void>;
  getExecution(id: string): Promise<ExecutionDocument | undefined>;
  updateExecution(id: string, patch: Partial<ExecutionDocument>): Promise<void>;

  // ---- tool calls ----
  addToolCall(toolCall: ToolCallDocument): Promise<void>;
  updateToolCall(id: string, patch: Partial<ToolCallDocument>): Promise<void>;

  // ---- approvals ----
  createApproval(approval: ApprovalDocument): Promise<void>;
  getApproval(id: string): Promise<ApprovalDocument | undefined>;
  setApprovalStatus(id: string, status: ApprovalDocument["status"]): Promise<void>;

  // ---- events + audit ----
  appendEvent(event: AppendEventInput): Promise<void>;
  appendAudit(
    actorId: string,
    actorType: AuditLogDocument["actorType"],
    action: string,
    targetId: string,
    metadata: Record<string, unknown>
  ): Promise<void>;

  // ---- demo + settings ----
  resetDemoData(): Promise<DashboardSnapshot>;
  getProviderSettings(): Promise<ProviderSettingsDocument>;
  updateProviderSettings(input: UpsertProviderSettingsInput, encryptionSecret: string): Promise<ProviderSettingsPublic>;

  // ---- notes ----
  notesStore(): NotesStore;
}

// ---------------------------------------------------------------------------
// Helpers shared by both implementations.
// ---------------------------------------------------------------------------

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function defaultProviderSettings(companyId: string): ProviderSettingsDocument {
  return {
    _id: `provider_${companyId}`,
    companyId,
    provider: "mock",
    model: "mock",
    apiKeySet: false,
    updatedAt: nowIso()
  };
}

export function publicProviderSettings(settings: ProviderSettingsDocument): ProviderSettingsPublic {
  return {
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    apiKeySet: settings.apiKeySet,
    apiKeyLast4: settings.apiKeyLast4,
    updatedAt: settings.updatedAt
  };
}

export function seedSnapshot(): Omit<DashboardSnapshot, "notes"> {
  const companyId = "company_local";

  return {
    company: {
      _id: companyId,
      name: "My Workspace",
      monthlyBudgetCents: 25000
    },
    agents: [
      {
        _id: "agent_researcher",
        companyId,
        name: "Researcher",
        role: "Reads URLs and the workspace; answers questions",
        status: "ready",
        model: "auto",
        budgetLimitCents: 50000,
        budgetUsedCents: 0,
        toolScopes: ["http:fetch", "file:read", "file:write", "notes:read", "notes:write"]
      },
      {
        _id: "agent_engineer",
        companyId,
        name: "Engineer",
        role: "Edits files and runs allowlisted shell commands",
        status: "ready",
        model: "auto",
        budgetLimitCents: 50000,
        budgetUsedCents: 0,
        toolScopes: ["http:fetch", "file:read", "file:write", "notes:read", "notes:write", "shell:exec"]
      }
    ],
    tasks: [
      {
        _id: "task_seed_1",
        companyId,
        ticketId: "ticket_seed_1",
        title: "Save a starter note",
        goal: "Use the notes tool to save a key called 'welcome' with any value.",
        assigneeAgentId: "agent_researcher",
        status: "queued",
        priority: 10,
        createdAt: nowIso()
      }
    ],
    approvals: [],
    executions: [],
    toolCalls: [],
    events: [
      {
        _id: "event_init",
        companyId,
        title: "System initialized",
        detail: "Agents, tools, and the audit chain are loaded.",
        costCents: 0,
        createdAt: nowIso()
      }
    ],
    auditLogs: [
      createAuditLog(companyId, "system", "system", "system.seed", companyId, undefined, {
        message: "Seeded initial workspace, agents, and audit chain."
      })
    ],
    providerSettings: {
      provider: "mock",
      model: "mock",
      apiKeySet: false,
      updatedAt: nowIso()
    }
  };
}

export function createAuditLog(
  companyId: string,
  actorId: string,
  actorType: AuditLogDocument["actorType"],
  action: string,
  targetId: string,
  previousHash: string | undefined,
  metadata: Record<string, unknown> = {}
): AuditLogDocument {
  const createdAt = nowIso();
  const hash = makeAuditHash({ companyId, actorId, actorType, action, targetId, previousHash, metadata, createdAt });

  return {
    _id: createId("audit"),
    companyId,
    actorId,
    actorType,
    action,
    targetId,
    previousHash,
    hash,
    metadata,
    createdAt
  };
}

export function makeAuditHash(input: Record<string, unknown>) {
  const json = JSON.stringify(input);
  return `audit_${createHash("sha256").update(json).digest("hex").slice(0, 16)}`;
}
