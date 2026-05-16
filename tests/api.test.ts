import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildServer } from "../apps/api/src/server";
import type { FastifyInstance } from "fastify";

process.env.NODE_ENV = "test";
process.env.API_AUTH_TOKEN = "test-token-with-enough-length-123456";
process.env.ENCRYPTION_SECRET = "test-encryption-secret-with-enough-length";
process.env.LLM_PROVIDER = "mock";
process.env.LLM_MODEL = "mock";
process.env.QESTRA_SHELL_ALLOWLIST = "echo";
process.env.QESTRA_AUTO_HEARTBEAT_SECONDS = "0";

let app: FastifyInstance;

before(async () => {
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app.close();
});

describe("API hardening", () => {
  it("rejects protected commands without a token when token auth is enabled", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/heartbeat",
      headers: { "content-type": "application/json", "x-user-role": "operator" },
      payload: {}
    });
    assert.equal(response.statusCode, 401);
  });

  it("stores provider settings without returning the full API key", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/settings/provider",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "admin"
      },
      payload: {
        provider: "openai-compatible",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "customer-owned-test-key-9876"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.apiKeySet, true);
    assert.equal(body.apiKeyLast4, "9876");
    assert.equal(body.baseUrl, "https://api.openai.com/v1");
    assert.equal(JSON.stringify(body).includes("customer-owned-test-key"), false);
  });
});

describe("Agent runtime", () => {
  before(async () => {
    // The hardening suite stored an openai-compatible provider with a fake key,
    // and demo/reset preserves provider settings on purpose. Switch back to
    // the mock provider so heartbeats don't try to call the real API.
    await app.inject({
      method: "PUT",
      url: "/api/settings/provider",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "admin"
      },
      payload: { provider: "mock", model: "mock" }
    });
    await app.inject({
      method: "POST",
      url: "/api/demo/reset",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "admin"
      },
      payload: {}
    });
  });

  it("exposes the registered tool set", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tools" });
    assert.equal(response.statusCode, 200);
    const names = (response.json() as Array<{ name: string }>).map((tool) => tool.name);
    for (const expected of ["http.fetch", "file.list", "file.read", "file.write", "notes.set", "notes.get", "shell.exec"]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
  });

  it("runs a task end-to-end with the mock provider and persists tool calls", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "operator"
      },
      payload: {
        title: "Save a remember note",
        goal: "Use notes.set to save key 'demo'",
        assigneeAgentId: "agent_researcher",
        priority: 50
      }
    });
    assert.equal(created.statusCode, 201);

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/heartbeat",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "operator"
      },
      payload: {}
    });

    assert.equal(heartbeat.statusCode, 200);
    const snapshot = heartbeat.json() as {
      executions: Array<{ status: string; messages: unknown[] }>;
      toolCalls: Array<{ toolName: string; status: string }>;
      notes: Array<{ key: string }>;
    };

    assert.ok(snapshot.executions.length >= 1, "expected at least one execution");
    const latest = snapshot.executions[0];
    assert.ok(["completed", "max_steps", "waiting_for_approval"].includes(latest.status), `unexpected status ${latest.status}`);

    const notesToolCall = snapshot.toolCalls.find((call) => call.toolName === "notes.set");
    assert.ok(notesToolCall, "expected a notes.set tool call to have been made");
    assert.equal(notesToolCall?.status, "executed");

    assert.ok(snapshot.notes.length >= 1, "expected the note to have been persisted");
  });

  it("pauses for approval on a sensitive tool (shell.exec)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/demo/reset",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "admin"
      },
      payload: {}
    });

    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "operator"
      },
      payload: {
        title: "Run a shell deploy",
        goal: "Demonstrate the approval gate by deploying via shell.",
        assigneeAgentId: "agent_engineer",
        priority: 50
      }
    });

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/heartbeat",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "operator"
      },
      payload: {}
    });
    assert.equal(heartbeat.statusCode, 200);
    const snapshot = heartbeat.json() as {
      approvals: Array<{ _id: string; status: string; toolName: string }>;
      executions: Array<{ status: string }>;
    };
    const pending = snapshot.approvals.find((approval) => approval.status === "pending");
    assert.ok(pending, "expected a pending approval");
    assert.equal(pending?.toolName, "shell.exec");
    assert.equal(snapshot.executions[0].status, "waiting_for_approval");

    // Approve it and confirm the execution resumes.
    const approved = await app.inject({
      method: "POST",
      url: `/api/approvals/${pending!._id}/approve`,
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "admin"
      },
      payload: {}
    });
    assert.equal(approved.statusCode, 200);
    const resumed = approved.json() as {
      executions: Array<{ status: string }>;
      toolCalls: Array<{ toolName: string; status: string }>;
    };
    assert.notEqual(resumed.executions[0].status, "waiting_for_approval");
  });
});
