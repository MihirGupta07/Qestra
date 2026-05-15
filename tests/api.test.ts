import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildServer } from "../apps/api/src/server";
import type { FastifyInstance } from "fastify";

process.env.NODE_ENV = "test";
process.env.API_AUTH_TOKEN = "test-token-with-enough-length-123456";
process.env.ENCRYPTION_SECRET = "test-encryption-secret-with-enough-length";

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
        provider: "mock",
        model: "mock",
        apiKey: "customer-owned-test-key-9876"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.apiKeySet, true);
    assert.equal(body.apiKeyLast4, "9876");
    assert.equal(JSON.stringify(body).includes("customer-owned-test-key"), false);
  });

  it("creates execution, tool call, and audit records during a heartbeat", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/heartbeat",
      headers: {
        authorization: `Bearer ${process.env.API_AUTH_TOKEN}`,
        "content-type": "application/json",
        "x-user-role": "operator"
      },
      payload: {}
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.executions.length >= 1);
    assert.ok(body.toolCalls.length >= 1);
    assert.ok(body.auditLogs.length >= 2);
  });
});
