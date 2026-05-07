export type EntityId = string;

export type TaskStatus = "queued" | "running" | "blocked" | "done" | "failed";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ExecutionStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed";

export interface Company {
  id: EntityId;
  name: string;
  monthlyBudgetCents: number;
}

export interface Goal {
  id: EntityId;
  companyId: EntityId;
  parentGoalId?: EntityId;
  title: string;
  outcome: string;
}

export interface Agent {
  id: EntityId;
  companyId: EntityId;
  name: string;
  role: string;
  model: string;
  budgetCents: number;
  toolScopes: string[];
  heartbeatCron?: string;
}

export interface Task {
  id: EntityId;
  companyId: EntityId;
  goalId: EntityId;
  ticketId: EntityId;
  assigneeAgentId: EntityId;
  title: string;
  status: TaskStatus;
  priority: number;
}

export interface Ticket {
  id: EntityId;
  companyId: EntityId;
  subject: string;
  state: "open" | "blocked" | "closed";
}

export interface Execution {
  id: EntityId;
  companyId: EntityId;
  taskId: EntityId;
  agentId: EntityId;
  status: ExecutionStatus;
  inputSummary: string;
  outputSummary?: string;
  costCents: number;
}

export interface ToolCall {
  id: EntityId;
  executionId: EntityId;
  toolName: string;
  requestedScope: string;
  approvalId?: EntityId;
  status: "proposed" | "approved" | "rejected" | "executed" | "failed";
}

export interface Approval {
  id: EntityId;
  companyId: EntityId;
  executionId: EntityId;
  requestedByAgentId: EntityId;
  title: string;
  reason: string;
  status: ApprovalStatus;
}

export interface AuditLog {
  id: EntityId;
  companyId: EntityId;
  actorId: EntityId;
  action: string;
  targetId: EntityId;
  createdAt: string;
  metadata: Record<string, unknown>;
}
