const API_BASE = "http://localhost:4000";

const fallbackState = {
  company: {
    _id: "company_acme",
    name: "Acme Robotics",
    monthlyBudgetCents: 25000
  },
  agents: [
    {
      _id: "agent_ceo",
      name: "CEO Agent",
      role: "Goal decomposition",
      status: "ready",
      budgetUsedCents: 720
    },
    {
      _id: "agent_cto",
      name: "CTO Agent",
      role: "Engineering planning",
      status: "ready",
      budgetUsedCents: 510
    },
    {
      _id: "agent_eng",
      name: "Engineer Agent",
      role: "Implementation",
      status: "ready",
      budgetUsedCents: 612
    }
  ],
  tasks: [
    {
      _id: "task_001",
      title: "Design first execution lifecycle",
      goal: "Prove governed agent work loop",
      assigneeAgentId: "agent_cto",
      status: "queued"
    },
    {
      _id: "task_002",
      title: "Draft approval gate for deploy actions",
      goal: "Prevent sensitive autonomous changes",
      assigneeAgentId: "agent_eng",
      status: "queued"
    }
  ],
  approvals: [],
  events: [
    {
      _id: "event_init",
      title: "System initialized",
      detail: "Company, agents, queue, budget, and audit stream are loaded locally.",
      costCents: 0
    }
  ]
};

let state = structuredClone(fallbackState);
let apiOnline = false;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

function byId(id) {
  return document.getElementById(id);
}

function centsToDollars(cents) {
  return cents / 100;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

async function loadSnapshot() {
  try {
    state = await api("/api/snapshot");
    apiOnline = true;
  } catch {
    apiOnline = false;
    state = structuredClone(fallbackState);
  }

  render();
}

function render() {
  const totalSpendCents = state.agents.reduce((sum, agent) => sum + agent.budgetUsedCents, 0);
  byId("activeAgents").textContent = state.agents.length;
  byId("openTasks").textContent = state.tasks.filter((task) => task.status !== "done").length;
  byId("pendingApprovals").textContent = state.approvals.filter((approval) => approval.status === "pending").length;
  byId("budgetUsed").textContent = money.format(centsToDollars(totalSpendCents));
  byId("systemState").textContent = apiOnline ? "API Connected" : "Local Fallback";
  byId("systemState").classList.toggle("running", apiOnline);

  byId("agentList").innerHTML = state.agents
    .map(
      (agent) => `
        <article class="agent">
          <div class="row">
            <strong>${agent.name}</strong>
            <span class="badge ${agent.status === "running" ? "running" : ""}">${agent.status}</span>
          </div>
          <p>${agent.role} · ${money.format(centsToDollars(agent.budgetUsedCents))} spent</p>
        </article>
      `
    )
    .join("");

  byId("taskList").innerHTML = state.tasks
    .map(
      (task) => `
        <article class="task">
          <div class="row">
            <strong>${task.title}</strong>
            <span class="badge ${task.status === "blocked" ? "blocked" : "pending"}">${task.status}</span>
          </div>
          <p>${task.goal}</p>
        </article>
      `
    )
    .join("");

  byId("approvalList").innerHTML = state.approvals.length
    ? state.approvals
        .map(
          (approval) => `
            <article class="approval">
              <div class="row">
                <strong>${approval.title}</strong>
                <span class="badge ${approval.status === "pending" ? "pending" : "running"}">${approval.status}</span>
              </div>
              <p>${approval.reason}</p>
              ${
                approval.status === "pending"
                  ? `<div class="approval-actions">
                      <button data-approve="${approval._id}">Approve</button>
                      <button class="secondary" data-reject="${approval._id}">Reject</button>
                    </div>`
                  : ""
              }
            </article>
          `
        )
        .join("")
    : `<article class="approval"><strong>No pending approvals</strong><p>Sensitive tool calls will appear here before execution continues.</p></article>`;

  byId("executionStream").innerHTML = state.events
    .slice()
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
    .map(
      (event) => `
        <article class="event">
          <strong>${event.title}</strong>
          <p>${event.detail}${event.costCents ? ` Cost: ${money.format(centsToDollars(event.costCents))}.` : ""}</p>
        </article>
      `
    )
    .join("");

  document.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => resolveApproval(button.dataset.approve, "approve"));
  });

  document.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => resolveApproval(button.dataset.reject, "reject"));
  });
}

async function createTask() {
  if (!apiOnline) {
    const next = state.tasks.length + 1;
    state.tasks.push({
      _id: `task_${String(next).padStart(3, "0")}`,
      title: next % 2 === 0 ? "Review execution trace storage" : "Add scoped shell permission policy",
      goal: "Increase reliability and governance",
      assigneeAgentId: next % 2 === 0 ? "agent_cto" : "agent_eng",
      status: "queued"
    });
    state.events.push({
      _id: `event_${Date.now()}`,
      title: "Task created",
      detail: "A new ticket-backed task entered the local queue.",
      costCents: 0,
      createdAt: new Date().toISOString()
    });
    render();
    return;
  }

  await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: state.tasks.length % 2 === 0 ? "Add scoped shell permission policy" : "Review execution trace storage",
      goal: "Increase reliability and governance",
      assigneeAgentId: state.tasks.length % 2 === 0 ? "agent_eng" : "agent_cto"
    })
  });
  await loadSnapshot();
}

async function runHeartbeat() {
  if (!apiOnline) {
    runLocalHeartbeat();
    return;
  }

  state = await api("/api/heartbeat", { method: "POST", body: "{}" });
  render();
}

function runLocalHeartbeat() {
  const queuedTask = state.tasks.find((task) => task.status === "queued");
  if (!queuedTask) {
    state.events.push({
      _id: `event_${Date.now()}`,
      title: "Heartbeat completed",
      detail: "No queued work was available for assignment.",
      costCents: 0,
      createdAt: new Date().toISOString()
    });
    render();
    return;
  }

  const agent = state.agents.find((candidate) => candidate._id === queuedTask.assigneeAgentId);
  queuedTask.status = "running";
  agent.status = "running";

  window.setTimeout(() => {
    const executionCostCents = 125 + Math.floor(Math.random() * 350);
    agent.budgetUsedCents += executionCostCents;

    if (queuedTask.title.toLowerCase().includes("approval") || queuedTask.title.toLowerCase().includes("shell")) {
      queuedTask.status = "blocked";
      state.approvals.push({
        _id: `approval_${Date.now()}`,
        title: "Sensitive tool call requested",
        reason: `${agent.name} wants permission to execute a protected action for ${queuedTask.title}.`,
        taskId: queuedTask._id,
        status: "pending"
      });
      state.events.push({
        _id: `event_${Date.now()}`,
        title: "Approval required",
        detail: "Execution paused until a human resolves the governance request.",
        costCents: executionCostCents,
        createdAt: new Date().toISOString()
      });
    } else {
      queuedTask.status = "done";
      state.events.push({
        _id: `event_${Date.now()}`,
        title: "Execution completed",
        detail: `${agent.name} completed the task and wrote an audit event.`,
        costCents: executionCostCents,
        createdAt: new Date().toISOString()
      });
    }

    agent.status = "ready";
    render();
  }, 500);

  render();
}

async function resolveApproval(id, action) {
  if (!apiOnline) {
    const approval = state.approvals.find((candidate) => candidate._id === id);
    if (!approval) return;
    approval.status = action === "approve" ? "approved" : "rejected";
    const task = state.tasks.find((candidate) => candidate._id === approval.taskId);
    if (task) task.status = action === "approve" ? "done" : "queued";
    render();
    return;
  }

  state = await api(`/api/approvals/${id}/${action}`, { method: "POST", body: "{}" });
  render();
}

byId("heartbeatBtn").addEventListener("click", runHeartbeat);
byId("newTaskBtn").addEventListener("click", createTask);
loadSnapshot();
