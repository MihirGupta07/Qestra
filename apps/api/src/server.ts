import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { requireRole } from "./auth/rbac";
import { readConfig } from "./config";
import { createLLMProviderFromKey } from "./llm/create-llm-provider";
import { resolveCompanyLLMProvider } from "./llm/resolve-company-provider";
import { createHeartbeatQueue } from "./queue/heartbeat-queue";
import { createRepository } from "./repositories/create-repository";
import { decryptSecret } from "./security/secrets";

const createTaskSchema = z.object({
  title: z.string().min(3),
  goal: z.string().min(3),
  assigneeAgentId: z.string().optional()
});

const providerSettingsSchema = z.object({
  provider: z.enum(["mock", "openai", "anthropic"]),
  model: z.string().min(2),
  apiKey: z.string().min(6).optional()
});

export async function buildServer() {
  const config = readConfig();
  const repository = await createRepository(config);
  const heartbeatQueue = createHeartbeatQueue(config.redisUrl);
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true
  });

  app.get("/health", async () => ({
    ok: true,
    storage: config.mongoUri ? "mongodb" : "memory",
    queue: heartbeatQueue.enabled ? "bullmq" : "disabled"
  }));

  app.get("/api/snapshot", async () => repository.getSnapshot());

  app.get("/api/settings/provider", async () => repository.getSnapshot().then((snapshot) => snapshot.providerSettings));

  app.put("/api/settings/provider", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = providerSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid provider settings payload", issues: parsed.error.issues });
    }

    const settings = await repository.updateProviderSettings(parsed.data, config.encryptionSecret);
    return settings;
  });

  app.post("/api/settings/provider/test", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = providerSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid provider settings payload", issues: parsed.error.issues });
    }

    const storedSettings = await repository.getProviderSettings();
    const storedApiKey =
      !parsed.data.apiKey && storedSettings.provider === parsed.data.provider && storedSettings.encryptedApiKey
        ? decryptSecret(storedSettings.encryptedApiKey, config.encryptionSecret)
        : undefined;
    const provider = createLLMProviderFromKey({
      provider: parsed.data.provider,
      model: parsed.data.model,
      apiKey: parsed.data.apiKey ?? storedApiKey,
      fallback: config
    });
    const result = await provider.generate({
      system: "Reply with a short connection confirmation.",
      messages: [{ role: "user", content: "Test this model connection." }],
      maxTokens: 80
    });

    return {
      ok: true,
      provider: provider.name,
      model: parsed.data.model,
      costCents: result.costCents,
      preview: result.content.slice(0, 160)
    };
  });

  app.post("/api/tasks", { preHandler: requireRole("operator") }, async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid task payload", issues: parsed.error.issues });
    }

    const task = await repository.createTask(parsed.data);
    return reply.code(201).send(task);
  });

  app.post("/api/heartbeat", { preHandler: requireRole("operator") }, async () => {
    if (heartbeatQueue.enabled) {
      await heartbeatQueue.enqueue();
      return repository.getSnapshot();
    }

    const llm = await resolveCompanyLLMProvider(repository, config);
    return repository.runHeartbeat(llm);
  });

  app.post("/api/approvals/:id/approve", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = await repository.resolveApproval(id, "approved");
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    return repository.getSnapshot();
  });

  app.post("/api/approvals/:id/reject", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = await repository.resolveApproval(id, "rejected");
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    return repository.getSnapshot();
  });

  return app;
}
