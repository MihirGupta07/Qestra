"use client";

import {
  Activity,
  Bot,
  Check,
  ClipboardList,
  Clock,
  DollarSign,
  GitBranch,
  KeyRound,
  Play,
  Save,
  ShieldCheck,
  Ticket,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

const API_BASE = "/api/qestra";

type Agent = {
  _id: string;
  name: string;
  role: string;
  status: string;
  budgetUsedCents: number;
};

type Task = {
  _id: string;
  title: string;
  goal: string;
  status: string;
};

type Approval = {
  _id: string;
  title: string;
  reason: string;
  status: string;
};

type Event = {
  _id: string;
  title: string;
  detail: string;
  costCents: number;
  createdAt?: string;
};

type Execution = {
  _id: string;
  status: string;
  provider: string;
  inputSummary: string;
  outputSummary: string;
  costCents: number;
};

type ToolCall = {
  _id: string;
  toolName: string;
  requestedScope: string;
  sensitive: boolean;
  status: string;
};

type AuditLog = {
  _id: string;
  action: string;
  actorType: string;
  targetId: string;
  hash: string;
  previousHash?: string;
};

type ProviderSettings = {
  provider: "mock" | "openai" | "anthropic";
  model: string;
  apiKeySet: boolean;
  apiKeyLast4?: string;
  updatedAt?: string;
};

type Snapshot = {
  company: { _id: string; name: string; monthlyBudgetCents: number };
  agents: Agent[];
  tasks: Task[];
  approvals: Approval[];
  executions: Execution[];
  toolCalls: ToolCall[];
  events: Event[];
  auditLogs: AuditLog[];
  providerSettings: ProviderSettings;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function cents(centsValue: number) {
  return money.format(centsValue / 100);
}

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [apiOnline, setApiOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [providerForm, setProviderForm] = useState({
    provider: "mock" as ProviderSettings["provider"],
    model: "mock",
    apiKey: ""
  });
  const [taskForm, setTaskForm] = useState({
    title: "Review governed tool execution",
    goal: "Increase reliability and governance",
    assigneeAgentId: "agent_eng",
    priority: 5
  });
  const [settingsMessage, setSettingsMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const totals = useMemo(() => {
    const agents = snapshot?.agents ?? [];
    const tasks = snapshot?.tasks ?? [];
    const approvals = snapshot?.approvals ?? [];

    return {
      spendCents: agents.reduce((sum, agent) => sum + agent.budgetUsedCents, 0),
      openTasks: tasks.filter((task) => task.status !== "done").length,
      pendingApprovals: approvals.filter((approval) => approval.status === "pending").length
    };
  }, [snapshot]);

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { "content-type": "application/json" },
      cache: "no-store",
      ...options
    });

    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  }

  async function load() {
    try {
      const nextSnapshot = await request("/api/snapshot") as Snapshot;
      setSnapshot(nextSnapshot);
      setProviderForm((current) => ({
        provider: nextSnapshot.providerSettings.provider,
        model: nextSnapshot.providerSettings.model,
        apiKey: current.apiKey
      }));
      setApiOnline(true);
    } catch {
      setApiOnline(false);
    }
  }

  async function saveProviderSettings() {
    await command(async () => {
      const body = {
        provider: providerForm.provider,
        model: providerForm.model,
        ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {})
      };
      await request("/api/settings/provider", { method: "PUT", body: JSON.stringify(body) });
      setSettingsMessage("Provider settings saved.");
      setProviderForm((current) => ({ ...current, apiKey: "" }));
    });
  }

  async function testProviderSettings() {
    setBusy(true);
    try {
      const body = {
        provider: providerForm.provider,
        model: providerForm.model,
        ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {})
      };
      const result = await request("/api/settings/provider/test", { method: "POST", body: JSON.stringify(body) });
      setSettingsMessage(`Connection ok: ${result.preview}`);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setBusy(false);
    }
  }

  async function command(action: () => Promise<unknown>) {
    setBusy(true);
    setActionMessage("");
    try {
      await action();
      await load();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Command failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Q</span>
          <div>
            <strong>Qestra OS</strong>
            <small>Agent orchestration</small>
          </div>
        </div>

        <nav className="nav">
          <button className="active"><Activity className="icon" /> Dashboard</button>
          <button><Bot className="icon" /> Agents</button>
          <button><Ticket className="icon" /> Tickets</button>
          <button><ShieldCheck className="icon" /> Approvals</button>
          <button><KeyRound className="icon" /> Keys</button>
          <button><GitBranch className="icon" /> Audit</button>
        </nav>
      </aside>

      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{snapshot?.company.name ?? "Acme Robotics"}</p>
            <h1>Orchestration Dashboard</h1>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary"
              disabled={busy || !apiOnline}
              onClick={() =>
                command(async () => {
                  await request("/api/heartbeat", { method: "POST", body: "{}" });
                  setActionMessage("Heartbeat submitted.");
                })
              }
            >
              <Play className="icon" /> Run Heartbeat
            </button>
            <button
              className="secondary"
              disabled={busy || !apiOnline}
              onClick={() => command(() => request("/api/demo/reset", { method: "POST", body: "{}" }))}
            >
              <X className="icon" /> Reset Demo
            </button>
          </div>
        </header>
        {actionMessage ? <p className="notice">{actionMessage}</p> : null}

        <section className="metrics">
          <Metric icon={<Bot className="icon" />} label="Active agents" value={String(snapshot?.agents.length ?? 0)} />
          <Metric icon={<Ticket className="icon" />} label="Open tasks" value={String(totals.openTasks)} />
          <Metric icon={<ShieldCheck className="icon" />} label="Pending approvals" value={String(totals.pendingApprovals)} />
          <Metric icon={<DollarSign className="icon" />} label="Budget used" value={cents(totals.spendCents)} />
        </section>

        <section className="workspace lower">
          <Panel eyebrow="Work intake" title="Create Task">
            <article className="item form-item">
              <label>
                Title
                <input
                  value={taskForm.title}
                  onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))}
                />
              </label>
              <label>
                Goal
                <input
                  value={taskForm.goal}
                  onChange={(event) => setTaskForm((current) => ({ ...current, goal: event.target.value }))}
                />
              </label>
              <label>
                Assignee
                <select
                  value={taskForm.assigneeAgentId}
                  onChange={(event) => setTaskForm((current) => ({ ...current, assigneeAgentId: event.target.value }))}
                >
                  {(snapshot?.agents ?? []).map((agent) => (
                    <option key={agent._id} value={agent._id}>{agent.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={taskForm.priority}
                  onChange={(event) => setTaskForm((current) => ({ ...current, priority: Number(event.target.value) }))}
                />
              </label>
              <button
                disabled={busy || !apiOnline || taskForm.title.length < 3 || taskForm.goal.length < 3}
                onClick={() =>
                  command(async () => {
                    await request("/api/tasks", {
                      method: "POST",
                      body: JSON.stringify(taskForm)
                    });
                    setActionMessage("Task created.");
                  })
                }
              >
                <ClipboardList className="icon" /> Create Task
              </button>
              <p>Use words like deploy, shell, approval, or delete to trigger the approval gate.</p>
            </article>
          </Panel>

          <Panel eyebrow="Workspace settings" title="Provider Keys">
            <article className="item form-item">
              <label>
                Provider
                <select
                  value={providerForm.provider}
                  onChange={(event) => {
                    const provider = event.target.value as ProviderSettings["provider"];
                    setProviderForm({
                      provider,
                      model: provider === "openai" ? "gpt-4.1-mini" : provider === "anthropic" ? "claude-3-5-haiku-latest" : "mock",
                      apiKey: ""
                    });
                  }}
                >
                  <option value="mock">Mock</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <label>
                Model
                <input
                  value={providerForm.model}
                  onChange={(event) => setProviderForm((current) => ({ ...current, model: event.target.value }))}
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  placeholder={snapshot?.providerSettings.apiKeySet ? `Stored key ending ${snapshot.providerSettings.apiKeyLast4}` : "Paste customer-owned key"}
                  value={providerForm.apiKey}
                  onChange={(event) => setProviderForm((current) => ({ ...current, apiKey: event.target.value }))}
                />
              </label>
              <div className="approval-actions">
                <button disabled={busy || !apiOnline} onClick={saveProviderSettings}>
                  <Save className="icon" /> Save
                </button>
                <button className="secondary" disabled={busy || !apiOnline} onClick={testProviderSettings}>
                  <Clock className="icon" /> Test
                </button>
              </div>
              <p>{settingsMessage || "Keys are encrypted before storage. The dashboard never receives the full key back."}</p>
            </article>
          </Panel>

          <Panel eyebrow="BYOK status" title="Current Provider">
            <article className="item">
              <div className="row">
                <strong>{snapshot?.providerSettings.provider ?? "mock"}</strong>
                <span className={`badge ${snapshot?.providerSettings.apiKeySet ? "running" : "pending"}`}>
                  {snapshot?.providerSettings.apiKeySet ? "key stored" : "no key"}
                </span>
              </div>
              <p>
                {snapshot?.providerSettings.model ?? "mock"}
                {snapshot?.providerSettings.apiKeyLast4 ? ` · ending ${snapshot.providerSettings.apiKeyLast4}` : ""}
              </p>
            </article>
          </Panel>
        </section>

        <section className="workspace">
          <Panel eyebrow="Execution graph" title="Live Agent Work" status={apiOnline ? "API Connected" : "API Offline"}>
            {(snapshot?.events ?? []).map((event) => (
              <article className="item" key={event._id}>
                <strong>{event.title}</strong>
                <p>{event.detail}{event.costCents ? ` Cost: ${cents(event.costCents)}.` : ""}</p>
              </article>
            ))}
          </Panel>

          <Panel eyebrow="Roster" title="Agents">
            {(snapshot?.agents ?? []).map((agent) => (
              <article className="item" key={agent._id}>
                <div className="row">
                  <strong>{agent.name}</strong>
                  <span className={`badge ${agent.status === "running" ? "running" : ""}`}>{agent.status}</span>
                </div>
                <p>{agent.role} · {cents(agent.budgetUsedCents)} spent</p>
              </article>
            ))}
          </Panel>
        </section>

        <section className="workspace lower">
          <Panel eyebrow="Queue" title="Tasks">
            {(snapshot?.tasks ?? []).map((task) => (
              <article className="item" key={task._id}>
                <div className="row">
                  <strong>{task.title}</strong>
                  <span className={`badge ${task.status === "blocked" ? "blocked" : "pending"}`}>{task.status}</span>
                </div>
                <p>{task.goal}</p>
              </article>
            ))}
          </Panel>

          <Panel eyebrow="Governance" title="Approvals">
            {(snapshot?.approvals ?? []).length === 0 ? (
              <article className="item">
                <strong>No pending approvals</strong>
                <p>Sensitive tool calls will appear here before execution continues.</p>
              </article>
            ) : (
              snapshot?.approvals.map((approval) => (
                <article className="item" key={approval._id}>
                  <div className="row">
                    <strong>{approval.title}</strong>
                    <span className={`badge ${approval.status === "pending" ? "pending" : "running"}`}>{approval.status}</span>
                  </div>
                  <p>{approval.reason}</p>
                  {approval.status === "pending" ? (
                    <div className="approval-actions">
                      <button onClick={() => command(() => request(`/api/approvals/${approval._id}/approve`, { method: "POST", body: "{}" }))}>
                        <Check className="icon" /> Approve
                      </button>
                      <button
                        className="secondary"
                        onClick={() => command(() => request(`/api/approvals/${approval._id}/reject`, { method: "POST", body: "{}" }))}
                      >
                        <X className="icon" /> Reject
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </Panel>
        </section>

        <section className="workspace lower">
          <Panel eyebrow="Runtime" title="Executions">
            {(snapshot?.executions ?? []).length === 0 ? (
              <article className="item">
                <strong>No executions yet</strong>
                <p>Run a heartbeat to create a durable execution record.</p>
              </article>
            ) : (
              snapshot?.executions.map((execution) => (
                <article className="item" key={execution._id}>
                  <div className="row">
                    <strong>{execution.inputSummary}</strong>
                    <span className={`badge ${execution.status === "waiting_for_approval" ? "blocked" : "pending"}`}>{execution.status}</span>
                  </div>
                  <p>{execution.provider} · {execution.outputSummary} · {cents(execution.costCents)}</p>
                </article>
              ))
            )}
          </Panel>

          <Panel eyebrow="Tools" title="Tool Calls">
            {(snapshot?.toolCalls ?? []).length === 0 ? (
              <article className="item">
                <strong>No tool calls yet</strong>
                <p>Approved and blocked tool calls will be tracked here.</p>
              </article>
            ) : (
              snapshot?.toolCalls.map((toolCall) => (
                <article className="item" key={toolCall._id}>
                  <div className="row">
                    <strong>{toolCall.toolName}</strong>
                    <span className={`badge ${toolCall.sensitive ? "blocked" : "pending"}`}>{toolCall.status}</span>
                  </div>
                  <p>{toolCall.requestedScope}</p>
                </article>
              ))
            )}
          </Panel>
        </section>

        <section className="workspace lower">
          <Panel eyebrow="Audit" title="Immutable Chain">
            {(snapshot?.auditLogs ?? []).map((auditLog) => (
              <article className="item" key={auditLog._id}>
                <div className="row">
                  <strong>{auditLog.action}</strong>
                  <span className="badge pending">{auditLog.actorType}</span>
                </div>
                <p>{auditLog.targetId} · {auditLog.hash}{auditLog.previousHash ? ` · previous ${auditLog.previousHash}` : ""}</p>
              </article>
            ))}
          </Panel>

          <Panel eyebrow="Runtime Isolation" title="Sandbox Policy">
            <article className="item">
              <strong>Protected actions require approval</strong>
              <p>Shell, deploy, delete, and external-write tools are routed through scope checks and human approval gates.</p>
            </article>
            <article className="item">
              <strong>Queue workers are detachable</strong>
              <p>Redis enables BullMQ workers without changing API behavior; no Redis keeps direct execution for local development.</p>
            </article>
          </Panel>
        </section>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article>
      <span className="row">{label}{icon}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({
  eyebrow,
  title,
  status,
  children
}: {
  eyebrow: string;
  title: string;
  status?: string;
  children: ReactNode;
}) {
  return (
    <div className="panel main-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {status ? <span className={`status-pill ${status.includes("Connected") ? "running" : ""}`}>{status}</span> : null}
      </div>
      <div className="list">{children}</div>
    </div>
  );
}
