export type Id = string;

export type TaskStatus = "queued" | "running" | "blocked" | "done" | "failed";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type UserRole = "owner" | "admin" | "operator" | "viewer";
export type LLMProviderName = "mock" | "openai" | "anthropic";

export interface AgentDocument {
  _id: Id;
  companyId: Id;
  name: string;
  role: string;
  status: "ready" | "running" | "paused";
  model: string;
  budgetLimitCents: number;
  budgetUsedCents: number;
  toolScopes: string[];
  heartbeatCron?: string;
}

export interface TaskDocument {
  _id: Id;
  companyId: Id;
  ticketId: Id;
  goal: string;
  title: string;
  assigneeAgentId: Id;
  status: TaskStatus;
  priority: number;
  createdAt: string;
}

export interface ApprovalDocument {
  _id: Id;
  companyId: Id;
  taskId: Id;
  executionId: Id;
  requestedByAgentId: Id;
  title: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
}

export interface ExecutionDocument {
  _id: Id;
  companyId: Id;
  taskId: Id;
  agentId: Id;
  status: "running" | "waiting_for_approval" | "completed" | "failed";
  provider: string;
  inputSummary: string;
  outputSummary: string;
  costCents: number;
  createdAt: string;
}

export interface ToolCallDocument {
  _id: Id;
  companyId: Id;
  executionId: Id;
  taskId: Id;
  agentId: Id;
  toolName: string;
  requestedScope: string;
  sensitive: boolean;
  status: "proposed" | "approval_required" | "approved" | "rejected" | "executed" | "denied";
  createdAt: string;
}

export interface ExecutionEventDocument {
  _id: Id;
  companyId: Id;
  taskId?: Id;
  agentId?: Id;
  title: string;
  detail: string;
  costCents: number;
  createdAt: string;
}

export interface AuditLogDocument {
  _id: Id;
  companyId: Id;
  actorId: Id;
  actorType: "agent" | "user" | "system";
  action: string;
  targetId: Id;
  hash: string;
  previousHash?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderSettingsDocument {
  _id: Id;
  companyId: Id;
  provider: LLMProviderName;
  model: string;
  encryptedApiKey?: string;
  apiKeyLast4?: string;
  apiKeySet: boolean;
  updatedAt: string;
}

export interface ProviderSettingsPublic {
  provider: LLMProviderName;
  model: string;
  apiKeySet: boolean;
  apiKeyLast4?: string;
  updatedAt?: string;
}

export interface DashboardSnapshot {
  company: {
    _id: Id;
    name: string;
    monthlyBudgetCents: number;
  };
  agents: AgentDocument[];
  tasks: TaskDocument[];
  approvals: ApprovalDocument[];
  executions: ExecutionDocument[];
  toolCalls: ToolCallDocument[];
  events: ExecutionEventDocument[];
  auditLogs: AuditLogDocument[];
  providerSettings: ProviderSettingsPublic;
}
