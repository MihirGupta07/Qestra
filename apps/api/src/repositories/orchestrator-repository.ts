import type {
  AgentDocument,
  AuditLogDocument,
  ApprovalDocument,
  DashboardSnapshot,
  ExecutionDocument,
  ExecutionEventDocument,
  LLMProviderName,
  ProviderSettingsDocument,
  ProviderSettingsPublic,
  TaskDocument
} from "../domain";
import type { LLMProvider } from "../../../../packages/llm/src/provider";

export interface CreateTaskInput {
  title: string;
  goal: string;
  assigneeAgentId?: string;
}

export interface UpsertProviderSettingsInput {
  provider: LLMProviderName;
  model: string;
  apiKey?: string;
}

export interface OrchestratorRepository {
  getSnapshot(): Promise<DashboardSnapshot>;
  createTask(input: CreateTaskInput): Promise<TaskDocument>;
  runHeartbeat(llm?: LLMProvider): Promise<DashboardSnapshot>;
  resolveApproval(id: string, status: "approved" | "rejected"): Promise<ApprovalDocument | undefined>;
  getProviderSettings(): Promise<ProviderSettingsDocument>;
  updateProviderSettings(input: UpsertProviderSettingsInput, encryptionSecret: string): Promise<ProviderSettingsPublic>;
}

export function centsToDollars(cents: number) {
  return cents / 100;
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function seedSnapshot(): DashboardSnapshot {
  const companyId = "company_acme";

  return {
    company: {
      _id: companyId,
      name: "Acme Robotics",
      monthlyBudgetCents: 25000
    },
    agents: [
      {
        _id: "agent_ceo",
        companyId,
        name: "CEO Agent",
        role: "Goal decomposition",
        status: "ready",
        model: "mock",
        budgetLimitCents: 10000,
        budgetUsedCents: 720,
        toolScopes: ["ticket:write", "audit:write"]
      },
      {
        _id: "agent_cto",
        companyId,
        name: "CTO Agent",
        role: "Engineering planning",
        status: "ready",
        model: "mock",
        budgetLimitCents: 8000,
        budgetUsedCents: 510,
        toolScopes: ["ticket:write", "audit:write"]
      },
      {
        _id: "agent_eng",
        companyId,
        name: "Engineer Agent",
        role: "Implementation",
        status: "ready",
        model: "mock",
        budgetLimitCents: 9000,
        budgetUsedCents: 612,
        toolScopes: ["ticket:write", "audit:write", "shell:scoped"]
      }
    ],
    tasks: [
      {
        _id: "task_001",
        companyId,
        ticketId: "ticket_001",
        title: "Design first execution lifecycle",
        goal: "Prove governed agent work loop",
        assigneeAgentId: "agent_cto",
        status: "queued",
        priority: 10,
        createdAt: nowIso()
      },
      {
        _id: "task_002",
        companyId,
        ticketId: "ticket_002",
        title: "Draft approval gate for deploy actions",
        goal: "Prevent sensitive autonomous changes",
        assigneeAgentId: "agent_eng",
        status: "queued",
        priority: 9,
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
        detail: "Company, agents, queue, budget, and audit stream are loaded from the API.",
        costCents: 0,
        createdAt: nowIso()
      }
    ],
    auditLogs: [
      createAuditLog(companyId, "system", "system", "system.seed", companyId, undefined, {
        message: "Seeded initial company, agents, tasks, and audit chain."
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
    apiKeySet: settings.apiKeySet,
    apiKeyLast4: settings.apiKeyLast4,
    updatedAt: settings.updatedAt
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
  let hash = 0;

  for (let index = 0; index < json.length; index += 1) {
    hash = (hash << 5) - hash + json.charCodeAt(index);
    hash |= 0;
  }

  return `audit_${Math.abs(hash).toString(16).padStart(8, "0")}`;
}
