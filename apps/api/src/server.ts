import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";
import { buildToolRegistry } from "../../../packages/tools/src/registry";
import { requireRole } from "./auth/rbac";
import { readConfig } from "./config";
import { createLLMProviderFromKey } from "./llm/create-llm-provider";
import { runHeartbeat, resolveApprovalAndResume } from "./orchestrator/heartbeat";
import { createHeartbeatQueue } from "./queue/heartbeat-queue";
import { createRepository } from "./repositories/create-repository";
import { decryptSecret } from "./security/secrets";
import { sseBroadcaster } from "./sse-broadcaster";

const createTaskSchema = z.object({
  title: z.string().min(3),
  goal: z.string().min(3),
  assigneeAgentId: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional()
});

const providerSettingsSchema = z.object({
  provider: z.enum(["mock", "openai-compatible", "anthropic"]),
  model: z.string().min(2),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(6).optional()
});

export async function buildServer() {
  const config = readConfig();
  const repository = await createRepository(config);
  const toolRouter = buildToolRegistry({
    workspaceDir: config.workspaceDir,
    notesStore: repository.notesStore(),
    shell: { allowedCommands: config.shellAllowlist, cwd: config.workspaceDir },
    http: { allowHosts: config.httpAllowHosts, denyHosts: config.httpDenyHosts }
  });
  const heartbeatQueue = createHeartbeatQueue(config.redisUrl);
  const app = Fastify({ logger: { level: config.nodeEnv === "test" ? "warn" : "info" } });

  await app.register(helmet);
  await app.register(rateLimit, {
    max: config.nodeEnv === "production" ? 300 : 1000,
    timeWindow: "1 minute"
  });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"), false);
    }
  });

  app.get("/health", async () => ({
    ok: true,
    storage: config.mongoUri ? "mongodb" : "memory",
    queue: heartbeatQueue.enabled ? "bullmq" : "disabled",
    workspaceDir: config.workspaceDir,
    autoHeartbeatSeconds: config.autoHeartbeatSeconds
  }));

  app.get("/api/snapshot", async () => repository.getSnapshot());

  // Server-Sent Events — push snapshot to all connected dashboards after each mutation.
  app.get("/api/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const send = (data: string) => reply.raw.write(`data: ${data}\n\n`);
    sseBroadcaster.add(send);

    // Push current state immediately so the client doesn't wait for the first event.
    repository.getSnapshot().then((snapshot) => send(JSON.stringify(snapshot))).catch(() => {});

    // Keep-alive comment every 25 s so proxies don't close idle connections.
    const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

    reply.raw.on("close", () => {
      sseBroadcaster.remove(send);
      clearInterval(keepAlive);
    });
  });

  app.get("/api/tools", async () =>
    toolRouter.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      requiredScope: tool.requiredScope,
      sensitive: tool.sensitive,
      parameters: tool.parameters
    }))
  );

  app.get("/api/settings/provider", async () =>
    repository.getSnapshot().then((snapshot) => snapshot.providerSettings)
  );

  app.put("/api/settings/provider", { preHandler: requireRole("admin", config) }, async (request, reply) => {
    const parsed = providerSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid provider settings payload", issues: parsed.error.issues });
    }
    return repository.updateProviderSettings(parsed.data, config.encryptionSecret);
  });

  app.post("/api/settings/provider/test", { preHandler: requireRole("admin", config) }, async (request, reply) => {
    const parsed = providerSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid provider settings payload", issues: parsed.error.issues });
    }
    const storedSettings = await repository.getProviderSettings();
    const storedApiKey =
      !parsed.data.apiKey && storedSettings.provider === parsed.data.provider && storedSettings.encryptedApiKey
        ? decryptSecret(storedSettings.encryptedApiKey, config.encryptionSecret)
        : undefined;

    try {
      const provider = createLLMProviderFromKey({
        provider: parsed.data.provider,
        model: parsed.data.model,
        baseUrl: parsed.data.baseUrl ?? storedSettings.baseUrl,
        apiKey: parsed.data.apiKey ?? storedApiKey,
        fallback: config
      });
      const result = await provider.generate({
        system: "Reply with a one-sentence connection confirmation.",
        messages: [{ role: "user", content: "Test this model connection." }],
        maxTokens: 80
      });
      return {
        ok: true,
        provider: provider.name,
        model: parsed.data.model,
        costCents: result.costCents,
        preview: result.content.slice(0, 200)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ ok: false, error: message });
    }
  });

  /** Push the latest snapshot to all connected SSE clients. */
  async function broadcast() {
    if (sseBroadcaster.size === 0) return;
    const snapshot = await repository.getSnapshot();
    sseBroadcaster.broadcast(JSON.stringify(snapshot));
  }

  app.post("/api/tasks", { preHandler: requireRole("operator", config) }, async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid task payload", issues: parsed.error.issues });
    }
    const task = await repository.createTask(parsed.data);
    broadcast().catch(() => {});
    return reply.code(201).send(task);
  });

  app.post("/api/heartbeat", { preHandler: requireRole("operator", config) }, async () => {
    if (heartbeatQueue.enabled) {
      await heartbeatQueue.enqueue();
      const snapshot = await repository.getSnapshot();
      sseBroadcaster.broadcast(JSON.stringify(snapshot));
      return snapshot;
    }
    await runHeartbeat({ repository, toolRouter, config });
    const snapshot = await repository.getSnapshot();
    sseBroadcaster.broadcast(JSON.stringify(snapshot));
    return snapshot;
  });

  app.post("/api/demo/reset", { preHandler: requireRole("admin", config) }, async () => {
    const snapshot = await repository.resetDemoData();
    sseBroadcaster.broadcast(JSON.stringify(snapshot));
    return snapshot;
  });

  app.post("/api/approvals/:id/approve", { preHandler: requireRole("admin", config) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = await resolveApprovalAndResume({ repository, toolRouter, config }, id, "approved");
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    const snapshot = await repository.getSnapshot();
    sseBroadcaster.broadcast(JSON.stringify(snapshot));
    return snapshot;
  });

  app.post("/api/approvals/:id/reject", { preHandler: requireRole("admin", config) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = await resolveApprovalAndResume({ repository, toolRouter, config }, id, "rejected");
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    const snapshot = await repository.getSnapshot();
    sseBroadcaster.broadcast(JSON.stringify(snapshot));
    return snapshot;
  });

  // Auto-heartbeat tick so queued tasks make progress without manual button presses.
  // Only enabled when the BullMQ path isn't doing it for us.
  if (config.autoHeartbeatSeconds > 0 && !heartbeatQueue.enabled && config.nodeEnv !== "test") {
    let ticking = false;
    const interval = setInterval(async () => {
      if (ticking) return;
      ticking = true;
      try {
        await runHeartbeat({ repository, toolRouter, config });
        await broadcast();
      } catch (error) {
        app.log.error({ err: error }, "auto-heartbeat failed");
      } finally {
        ticking = false;
      }
    }, config.autoHeartbeatSeconds * 1000);
    app.addHook("onClose", async () => clearInterval(interval));
  }

  return app;
}
