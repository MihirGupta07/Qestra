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
  StickyNote,
  Terminal,
  Ticket,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "/api/qestra";

type Provider = "mock" | "openai-compatible" | "groq" | "anthropic";

/** Groq is openai-compatible under the hood — translate before hitting the API. */
const providerApiName: Record<Provider, string> = {
  mock: "mock",
  "openai-compatible": "openai-compatible",
  groq: "openai-compatible",
  anthropic: "anthropic"
};

type Agent = {
  _id: string;
  name: string;
  role: string;
  status: string;
  budgetUsedCents: number;
  budgetLimitCents: number;
  toolScopes: string[];
};

type Task = { _id: string; title: string; goal: string; status: string };
type Approval = {
  _id: string;
  title: string;
  reason: string;
  status: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
};
type Event = { _id: string; title: string; detail: string; costCents: number; createdAt?: string };

type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

type Execution = {
  _id: string;
  taskId?: string;
  status: string;
  provider: string;
  model?: string;
  inputSummary: string;
  outputSummary: string;
  costCents: number;
  stepsUsed: number;
  messages: Message[];
  errorMessage?: string;
};

type ToolCall = {
  _id: string;
  toolName: string;
  status: string;
  sensitive: boolean;
  arguments?: Record<string, unknown>;
  output?: string;
  errorMessage?: string;
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
  provider: Provider;
  model: string;
  baseUrl?: string;
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
  notes: Array<{ key: string; value: string }>;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function cents(value: number) {
  return money.format(value / 100);
}

const providerPresets: Record<Provider, { baseUrl: string; model: string; label: string; hint: string }> = {
  mock: { baseUrl: "", model: "mock", label: "Mock", hint: "Deterministic offline provider. No key needed." },
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    label: "OpenAI-compatible",
    hint: "OpenAI, Nvidia NIM, Together, OpenRouter, Ollama — any /v1 endpoint."
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    label: "Groq",
    hint: "Groq Cloud — ultra-fast inference. Get a free key at console.groq.com."
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5-20251001",
    label: "Anthropic",
    hint: "Claude models with native tool_use."
  }
};

type Section = "dashboard" | "agents" | "tasks" | "approvals" | "keys" | "notes" | "audit";

const sectionTitles: Record<Section, string> = {
  dashboard: "Orchestration Dashboard",
  agents: "Agents",
  tasks: "Task Queue",
  approvals: "Approvals",
  keys: "LLM Keys",
  notes: "Memory / Notes",
  audit: "Audit Chain"
};

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [apiOnline, setApiOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [providerForm, setProviderForm] = useState({
    provider: "mock" as Provider,
    model: "mock",
    baseUrl: "",
    apiKey: ""
  });
  const [taskForm, setTaskForm] = useState({
    title: "Save a welcome note",
    goal: "Use notes.set with key 'welcome' and any value.",
    assigneeAgentId: "agent_researcher",
    priority: 5
  });
  const [settingsMessage, setSettingsMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [expandedExecution, setExpandedExecution] = useState<string | null>(null);
  const didInitForms = useRef(false);

  const totals = useMemo(() => {
    const agents = snapshot?.agents ?? [];
    const tasks = snapshot?.tasks ?? [];
    const approvals = snapshot?.approvals ?? [];
    return {
      spendCents: agents.reduce((sum, agent) => sum + agent.budgetUsedCents, 0),
      openTasks: tasks.filter((task) => task.status !== "done" && task.status !== "failed").length,
      pendingApprovals: approvals.filter((approval) => approval.status === "pending").length
    };
  }, [snapshot]);

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { "content-type": "application/json" },
      cache: "no-store",
      ...options
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `Request failed: ${response.status}`;
      try {
        const json = JSON.parse(text);
        if (json.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return text ? JSON.parse(text) : null;
  }

  async function load() {
    try {
      const nextSnapshot = (await request("/api/snapshot")) as Snapshot;
      setSnapshot(nextSnapshot);
      if (!didInitForms.current) {
        didInitForms.current = true;
        setProviderForm((current) => ({
          provider: nextSnapshot.providerSettings.provider as Provider,
          model: nextSnapshot.providerSettings.model,
          baseUrl: nextSnapshot.providerSettings.baseUrl ?? providerPresets[nextSnapshot.providerSettings.provider as Provider]?.baseUrl ?? "",
          apiKey: current.apiKey
        }));
      }
      setApiOnline(true);
    } catch {
      setApiOnline(false);
    }
  }

  function buildProviderBody() {
    const body: Record<string, unknown> = {
      provider: providerApiName[providerForm.provider],
      model: providerForm.model
    };
    if (providerForm.baseUrl) body.baseUrl = providerForm.baseUrl;
    if (providerForm.apiKey) body.apiKey = providerForm.apiKey;
    return body;
  }

  async function saveProviderSettings() {
    await command(async () => {
      await request("/api/settings/provider", { method: "PUT", body: JSON.stringify(buildProviderBody()) });
      setSettingsMessage("Provider settings saved.");
      setProviderForm((current) => ({ ...current, apiKey: "" }));
    });
  }

  async function testProviderSettings() {
    setBusy(true);
    setSettingsMessage("Testing…");
    try {
      const result = await request("/api/settings/provider/test", { method: "POST", body: JSON.stringify(buildProviderBody()) });
      setSettingsMessage(`✓ ${result.provider} (${result.model}): ${result.preview || "(empty)"}`);
    } catch (error) {
      setSettingsMessage(`✗ ${error instanceof Error ? error.message : "Connection test failed."}`);
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
    const interval = window.setInterval(load, 3000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Q</span>
          <div>
            <strong>Qestra</strong>
            <small>Agent orchestration</small>
          </div>
        </div>
        <nav className="nav">
          <button className={activeSection === "dashboard" ? "active" : ""} onClick={() => setActiveSection("dashboard")}><Activity className="icon" /> Dashboard</button>
          <button className={activeSection === "agents" ? "active" : ""} onClick={() => setActiveSection("agents")}><Bot className="icon" /> Agents</button>
          <button className={activeSection === "tasks" ? "active" : ""}  onClick={() => setActiveSection("tasks")}><Ticket className="icon" /> Tasks</button>
          <button className={activeSection === "approvals" ? "active" : ""} onClick={() => setActiveSection("approvals")}><ShieldCheck className="icon" /> Approvals</button>
          <button className={activeSection === "keys" ? "active" : ""} onClick={() => setActiveSection("keys")}><KeyRound className="icon" /> Keys</button>
          <button className={activeSection === "notes" ? "active" : ""} onClick={() => setActiveSection("notes")}><StickyNote className="icon" /> Notes</button>
          <button className={activeSection === "audit" ? "active" : ""} onClick={() => setActiveSection("audit")}><GitBranch className="icon" /> Audit</button>
        </nav>
      </aside>

      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{snapshot?.company.name ?? "Workspace"}</p>
            <h1>{sectionTitles[activeSection]}</h1>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary"
              disabled={busy || !apiOnline}
              onClick={() =>
                command(async () => {
                  await request("/api/heartbeat", { method: "POST", body: "{}" });
                  setActionMessage("Heartbeat ran.");
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
              <X className="icon" /> Reset
            </button>
          </div>
        </header>
        {actionMessage ? <p className="notice">{actionMessage}</p> : null}

        {activeSection === "dashboard" && (
          <>
            <section className="metrics">
              <Metric icon={<Bot className="icon" />} label="Agents" value={String(snapshot?.agents.length ?? 0)} />
              <Metric icon={<Ticket className="icon" />} label="Open tasks" value={String(totals.openTasks)} />
              <Metric icon={<ShieldCheck className="icon" />} label="Pending approvals" value={String(totals.pendingApprovals)} />
              <Metric icon={<DollarSign className="icon" />} label="Spend" value={cents(totals.spendCents)} />
            </section>

            <section className="workspace">
              <Panel eyebrow="Activity" title="Live Events" status={apiOnline ? "Connected" : "Offline"}>
                {(snapshot?.events ?? []).slice(0, 12).map((event) => (
                  <article className="item" key={event._id}>
                    <strong>{event.title}</strong>
                    <p>{event.detail}{event.costCents ? ` · ${cents(event.costCents)}` : ""}</p>
                  </article>
                ))}
              </Panel>
              <Panel eyebrow="Roster" title="Agents">
                {(snapshot?.agents ?? []).map((agent) => (
                  <article className="item" key={agent._id}>
                    <div className="row">
                      <strong>{agent.name}</strong>
                      <span className={`badge ${agent.status === "running" ? "running" : agent.status === "paused" ? "blocked" : ""}`}>{agent.status}</span>
                    </div>
                    <p>{agent.role}</p>
                    <p>{cents(agent.budgetUsedCents)} of {cents(agent.budgetLimitCents)} · scopes: {agent.toolScopes.join(", ")}</p>
                  </article>
                ))}
              </Panel>
            </section>

            <section className="workspace lower">
              <Panel eyebrow="Queue" title="Recent Tasks">
                {(snapshot?.tasks ?? []).length === 0 ? <article className="item"><p>No tasks yet.</p></article> : null}
                {(snapshot?.tasks ?? []).slice(0, 5).map((task) => {
                  const failedExecution = task.status === "failed"
                    ? (snapshot?.executions ?? []).find((e) => e.taskId === task._id && e.errorMessage)
                    : undefined;
                  return (
                    <article className="item" key={task._id}>
                      <div className="row">
                        <strong>{task.title}</strong>
                        <span className={`badge ${task.status === "blocked" || task.status === "failed" ? "blocked" : task.status === "done" ? "running" : "pending"}`}>{task.status}</span>
                      </div>
                      <p>{task.goal}</p>
                      {failedExecution?.errorMessage && (
                        <p className="error">↳ {failedExecution.errorMessage}</p>
                      )}
                    </article>
                  );
                })}
              </Panel>
              <Panel eyebrow="Governance" title="Pending Approvals">
                {(snapshot?.approvals ?? []).filter((a) => a.status === "pending").length === 0 ? (
                  <article className="item">
                    <strong>No pending approvals</strong>
                    <p>Sensitive tool calls pause here for your review.</p>
                  </article>
                ) : (
                  snapshot?.approvals.filter((a) => a.status === "pending").map((approval) => (
                    <article className="item" key={approval._id}>
                      <div className="row">
                        <strong>{approval.title}</strong>
                        <span className="badge pending">{approval.status}</span>
                      </div>
                      <p><code>{approval.toolName}</code></p>
                      <div className="approval-actions">
                        <button onClick={() => command(() => request(`/api/approvals/${approval._id}/approve`, { method: "POST", body: "{}" }))}>
                          <Check className="icon" /> Approve
                        </button>
                        <button className="secondary" onClick={() => command(() => request(`/api/approvals/${approval._id}/reject`, { method: "POST", body: "{}" }))}>
                          <X className="icon" /> Reject
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </Panel>
            </section>
          </>
        )}

        {activeSection === "agents" && (
          <section className="workspace">
            <Panel eyebrow="Roster" title="All Agents">
              {(snapshot?.agents ?? []).map((agent) => (
                <article className="item" key={agent._id}>
                  <div className="row">
                    <strong>{agent.name}</strong>
                    <span className={`badge ${agent.status === "running" ? "running" : agent.status === "paused" ? "blocked" : ""}`}>{agent.status}</span>
                  </div>
                  <p>{agent.role}</p>
                  <p>Budget: {cents(agent.budgetUsedCents)} / {cents(agent.budgetLimitCents)}{agent.budgetUsedCents >= agent.budgetLimitCents ? " · ⚠ limit reached" : ""}</p>
                  <p>Scopes: {agent.toolScopes.join(", ")}</p>
                </article>
              ))}
            </Panel>
            <Panel eyebrow="Activity" title="Live Events" status={apiOnline ? "Connected" : "Offline"}>
              {(snapshot?.events ?? []).slice(0, 20).map((event) => (
                <article className="item" key={event._id}>
                  <strong>{event.title}</strong>
                  <p>{event.detail}{event.costCents ? ` · ${cents(event.costCents)}` : ""}</p>
                </article>
              ))}
            </Panel>
          </section>
        )}

        {activeSection === "tasks" && (
          <>
            <section className="workspace lower">
              <Panel eyebrow="Work intake" title="Create Task">
                <article className="item form-item">
                  <label>Title<input value={taskForm.title} onChange={(e) => setTaskForm((c) => ({ ...c, title: e.target.value }))} /></label>
                  <label>Goal<input value={taskForm.goal} onChange={(e) => setTaskForm((c) => ({ ...c, goal: e.target.value }))} /></label>
                  <label>
                    Assignee
                    <select value={taskForm.assigneeAgentId} onChange={(e) => setTaskForm((c) => ({ ...c, assigneeAgentId: e.target.value }))}>
                      {(snapshot?.agents ?? []).map((agent) => <option key={agent._id} value={agent._id}>{agent.name}</option>)}
                    </select>
                  </label>
                  <label>Priority<input type="number" min={0} max={100} value={taskForm.priority} onChange={(e) => setTaskForm((c) => ({ ...c, priority: Number(e.target.value) }))} /></label>
                  <button disabled={busy || !apiOnline || taskForm.title.length < 3 || taskForm.goal.length < 3} onClick={() => command(async () => { await request("/api/tasks", { method: "POST", body: JSON.stringify(taskForm) }); setActionMessage("Task queued. Heartbeat to run it."); })}>
                    <ClipboardList className="icon" /> Create Task
                  </button>
                  <p>The agent will plan, call tools, and pause for approval on sensitive tools like shell.exec.</p>
                </article>
              </Panel>
              <Panel eyebrow="Queue" title="All Tasks">
                {(snapshot?.tasks ?? []).length === 0 ? <article className="item"><p>No tasks.</p></article> : null}
                {(snapshot?.tasks ?? []).map((task) => {
                  const failedExecution = task.status === "failed"
                    ? (snapshot?.executions ?? []).find((e) => e.taskId === task._id && e.errorMessage)
                    : undefined;
                  return (
                    <article className="item" key={task._id}>
                      <div className="row">
                        <strong>{task.title}</strong>
                        <span className={`badge ${task.status === "blocked" || task.status === "failed" ? "blocked" : task.status === "done" ? "running" : "pending"}`}>{task.status}</span>
                      </div>
                      <p>{task.goal}</p>
                      {failedExecution?.errorMessage && (
                        <p className="error">↳ {failedExecution.errorMessage}</p>
                      )}
                    </article>
                  );
                })}
              </Panel>
            </section>
            <section className="workspace lower">
              <Panel eyebrow="Runtime" title="Executions">
                {(snapshot?.executions ?? []).length === 0 ? <article className="item"><strong>No executions yet</strong><p>Create a task and click Run Heartbeat.</p></article> : null}
                {(snapshot?.executions ?? []).map((execution) => {
                  const expanded = expandedExecution === execution._id;
                  return (
                    <article className="item" key={execution._id}>
                      <div className="row">
                        <strong>{execution.inputSummary}</strong>
                        <span className={`badge ${execution.status === "completed" ? "running" : execution.status === "waiting_for_approval" ? "pending" : execution.status === "failed" ? "blocked" : "pending"}`}>{execution.status}</span>
                      </div>
                      <p>{execution.provider}{execution.model ? `/${execution.model}` : ""} · {execution.stepsUsed} steps · {cents(execution.costCents)}</p>
                      <p>{executionReason(execution)}</p>
                      <button className="secondary" onClick={() => setExpandedExecution(expanded ? null : execution._id)}>
                        <Terminal className="icon" /> {expanded ? "Hide" : "Show"} transcript ({execution.messages.length})
                      </button>
                      {expanded ? <Transcript messages={execution.messages} /> : null}
                    </article>
                  );
                })}
              </Panel>
              <Panel eyebrow="Tools" title="Tool Calls">
                {(snapshot?.toolCalls ?? []).length === 0 ? <article className="item"><strong>No tool calls yet</strong></article> : null}
                {(snapshot?.toolCalls ?? []).slice(0, 20).map((toolCall) => (
                  <article className="item" key={toolCall._id}>
                    <div className="row">
                      <strong>{toolCall.toolName}</strong>
                      <span className={`badge ${toolCall.status === "executed" ? "running" : toolCall.status === "failed" || toolCall.status === "denied" || toolCall.status === "rejected" ? "blocked" : "pending"}`}>{toolCall.status}{toolCall.sensitive ? " · sensitive" : ""}</span>
                    </div>
                    {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 ? <p><code>{JSON.stringify(toolCall.arguments).slice(0, 200)}</code></p> : null}
                    {toolCall.output ? <p className="output">{toolCall.output.slice(0, 400)}</p> : null}
                    {toolCall.errorMessage ? <p className="error">{toolCall.errorMessage}</p> : null}
                  </article>
                ))}
              </Panel>
            </section>
          </>
        )}

        {activeSection === "approvals" && (
          <section className="workspace">
            <Panel eyebrow="Governance" title="All Approvals">
              {(snapshot?.approvals ?? []).length === 0 ? (
                <article className="item"><strong>No approvals</strong><p>Sensitive tool calls (shell.exec) pause here for your approval before execution.</p></article>
              ) : (
                snapshot?.approvals.map((approval) => (
                  <article className="item" key={approval._id}>
                    <div className="row">
                      <strong>{approval.title}</strong>
                      <span className={`badge ${approval.status === "pending" ? "pending" : approval.status === "approved" ? "running" : "blocked"}`}>{approval.status}</span>
                    </div>
                    <p><code>{approval.toolName}({JSON.stringify(approval.toolArguments)})</code></p>
                    <p>{approval.reason}</p>
                    {approval.status === "pending" ? (
                      <div className="approval-actions">
                        <button onClick={() => command(() => request(`/api/approvals/${approval._id}/approve`, { method: "POST", body: "{}" }))}><Check className="icon" /> Approve & Run</button>
                        <button className="secondary" onClick={() => command(() => request(`/api/approvals/${approval._id}/reject`, { method: "POST", body: "{}" }))}><X className="icon" /> Reject</button>
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </Panel>
            <Panel eyebrow="Runtime" title="Executions">
              {(snapshot?.executions ?? []).length === 0 ? <article className="item"><strong>No executions yet</strong></article> : null}
              {(snapshot?.executions ?? []).map((execution) => {
                const expanded = expandedExecution === execution._id;
                return (
                  <article className="item" key={execution._id}>
                    <div className="row">
                      <strong>{execution.inputSummary}</strong>
                      <span className={`badge ${execution.status === "completed" ? "running" : execution.status === "waiting_for_approval" ? "pending" : execution.status === "failed" ? "blocked" : "pending"}`}>{execution.status}</span>
                    </div>
                    <p>{execution.provider}{execution.model ? `/${execution.model}` : ""} · {execution.stepsUsed} steps</p>
                    <p>{executionReason(execution)}</p>
                    <button className="secondary" onClick={() => setExpandedExecution(expanded ? null : execution._id)}><Terminal className="icon" /> {expanded ? "Hide" : "Show"} transcript ({execution.messages.length})</button>
                    {expanded ? <Transcript messages={execution.messages} /> : null}
                  </article>
                );
              })}
            </Panel>
          </section>
        )}

        {activeSection === "keys" && (
          <section className="workspace lower">
            <Panel eyebrow="Provider" title="LLM Keys">
              <article className="item form-item">
                <label>
                  Provider
                  <select value={providerForm.provider} onChange={(e) => { const p = e.target.value as Provider; setProviderForm({ provider: p, model: providerPresets[p].model, baseUrl: providerPresets[p].baseUrl, apiKey: "" }); }}>
                    {(Object.keys(providerPresets) as Provider[]).map((key) => <option key={key} value={key}>{providerPresets[key].label}</option>)}
                  </select>
                </label>
                <label>Model<input value={providerForm.model} onChange={(e) => setProviderForm((c) => ({ ...c, model: e.target.value }))} /></label>
                <label>Base URL<input placeholder="https://api.openai.com/v1" value={providerForm.baseUrl} onChange={(e) => setProviderForm((c) => ({ ...c, baseUrl: e.target.value }))} /></label>
                <label>
                  API key
                  <input type="password" placeholder={snapshot?.providerSettings.apiKeySet ? `stored key ending ${snapshot.providerSettings.apiKeyLast4}` : "paste your key"} value={providerForm.apiKey} onChange={(e) => setProviderForm((c) => ({ ...c, apiKey: e.target.value }))} />
                </label>
                <div className="approval-actions">
                  <button disabled={busy || !apiOnline} onClick={saveProviderSettings}><Save className="icon" /> Save</button>
                  <button className="secondary" disabled={busy || !apiOnline} onClick={testProviderSettings}><Clock className="icon" /> Test</button>
                </div>
                <p>{settingsMessage || providerPresets[providerForm.provider].hint}</p>
              </article>
            </Panel>
            <Panel eyebrow="Status" title="Current Provider">
              <article className="item">
                <div className="row">
                  <strong>{snapshot?.providerSettings.provider ?? "mock"}</strong>
                  <span className={`badge ${snapshot?.providerSettings.apiKeySet ? "running" : "pending"}`}>{snapshot?.providerSettings.apiKeySet ? "key stored" : "no key"}</span>
                </div>
                <p>{snapshot?.providerSettings.model ?? "mock"}{snapshot?.providerSettings.baseUrl ? ` · ${snapshot.providerSettings.baseUrl}` : ""}{snapshot?.providerSettings.apiKeyLast4 ? ` · …${snapshot.providerSettings.apiKeyLast4}` : ""}</p>
              </article>
            </Panel>
          </section>
        )}

        {activeSection === "notes" && (
          <section className="workspace">
            <Panel eyebrow="Memory" title="Saved Notes">
              {(snapshot?.notes ?? []).length === 0 ? <article className="item"><strong>No notes saved</strong><p>Agents write persistent state via notes.set. Notes survive across executions (until reset).</p></article> : null}
              {(snapshot?.notes ?? []).map((note) => (
                <article className="item" key={note.key}>
                  <strong>{note.key}</strong>
                  <p>{note.value}</p>
                </article>
              ))}
            </Panel>
          </section>
        )}

        {activeSection === "audit" && (
          <section className="workspace">
            <Panel eyebrow="Audit" title="Immutable Chain">
              {(snapshot?.auditLogs ?? []).length === 0 ? <article className="item"><strong>No audit entries yet.</strong></article> : null}
              {(snapshot?.auditLogs ?? []).map((log) => (
                <article className="item" key={log._id}>
                  <div className="row">
                    <strong>{log.action}</strong>
                    <span className="badge pending">{log.actorType}</span>
                  </div>
                  <p>Target: {log.targetId}</p>
                  <p><code>{log.hash}</code>{log.previousHash ? ` ← ${log.previousHash}` : " (genesis)"}</p>
                </article>
              ))}
            </Panel>
          </section>
        )}
      </main>
    </div>
  );
}

function executionReason(execution: Execution): string {
  if (execution.outputSummary) return execution.outputSummary;
  if (execution.errorMessage) return execution.errorMessage;
  // For failed/max_steps executions with no summary, surface the last thing the agent said.
  const lastAssistant = [...execution.messages].reverse().find((m) => m.role === "assistant" && "content" in m && m.content);
  if (lastAssistant && "content" in lastAssistant && lastAssistant.content) {
    return lastAssistant.content.slice(0, 300);
  }
  return "(no output)";
}

function Transcript({ messages }: { messages: Message[] }) {
  return (
    <div className="transcript">
      {messages.map((message, index) => (
        <div key={index} className={`transcript-row transcript-${message.role}`}>
          <span className="transcript-role">{message.role}{message.role === "tool" ? `:${message.toolName}` : ""}</span>
          <pre>{"content" in message ? message.content : ""}</pre>
          {message.role === "assistant" && message.toolCalls?.length
            ? message.toolCalls.map((call) => <pre key={call.id} className="transcript-tool-call">→ {call.name}({JSON.stringify(call.arguments)})</pre>)
            : null}
        </div>
      ))}
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

function Panel({ eyebrow, title, status, children }: { eyebrow: string; title: string; status?: string; children: ReactNode }) {
  return (
    <div className="panel main-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {status ? <span className={`status-pill ${status === "Connected" ? "running" : ""}`}>{status}</span> : null}
      </div>
      <div className="list">{children}</div>
    </div>
  );
}
