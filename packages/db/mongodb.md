# MongoDB Data Model

MongoDB is the primary store for the NoSQL-first version of the platform.

## Collections

- `companies`
- `agents`
- `tasks`
- `tickets`
- `approvals`
- `executions`
- `tool_calls`
- `execution_events`
- `executions`
- `tool_calls`
- `audit_logs`
- `provider_settings`
- `audit_logs`
- `memory_chunks`

The current implementation persists the Phase 1-3 collections first:

- `companies`
- `agents`
- `tasks`
- `approvals`
- `execution_events`

The remaining collections are reserved for Phase 4+ when real tools, tickets, LLM calls, and memory retrieval are added.

## Important Indexes

```js
db.tasks.createIndex({ companyId: 1, status: 1, priority: -1, createdAt: 1 });
db.approvals.createIndex({ companyId: 1, status: 1, createdAt: -1 });
db.execution_events.createIndex({ companyId: 1, createdAt: -1 });
db.executions.createIndex({ companyId: 1, taskId: 1, createdAt: -1 });
db.tool_calls.createIndex({ companyId: 1, executionId: 1, createdAt: -1 });
db.agents.createIndex({ companyId: 1, status: 1 });
db.audit_logs.createIndex({ companyId: 1, createdAt: -1 });
db.provider_settings.createIndex({ companyId: 1 }, { unique: true });
```

## Task Checkout

Workers should atomically claim tasks with `findOneAndUpdate`:

```js
db.tasks.findOneAndUpdate(
  { companyId, status: "queued" },
  { $set: { status: "running" } },
  { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" }
);
```

This prevents two agents from taking the same task.

## Document Shape

Keep high-volume streams as separate collections. Tickets can embed recent messages, but execution traces and tool calls should be append-only documents so they can be paginated, archived, and audited.
