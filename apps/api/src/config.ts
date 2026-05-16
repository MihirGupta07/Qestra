import "dotenv/config";
import { resolve } from "node:path";
import { z } from "zod";

export interface ApiConfig {
  host: string;
  port: number;
  nodeEnv: "development" | "test" | "production";
  mongoDbName: string;
  mongoUri?: string;
  redisUrl?: string;
  /** Fallback API key used only when the customer hasn't stored their own. */
  fallbackApiKey?: string;
  fallbackBaseUrl?: string;
  defaultProvider: "mock" | "openai-compatible" | "anthropic";
  defaultModel: string;
  encryptionSecret: string;
  apiAuthToken?: string;
  corsOrigins: string[];
  /** Workspace dir for file.* tools. */
  workspaceDir: string;
  /** Allowlisted shell commands (executable names only). Empty disables shell.exec. */
  shellAllowlist: string[];
  httpAllowHosts: string[];
  httpDenyHosts: string[];
  /** Hard cap on LLM/tool loop iterations per execution. */
  maxRuntimeSteps: number;
  /** Seconds between automatic heartbeats. 0 disables the auto-tick. */
  autoHeartbeatSeconds: number;
}

export function readConfig(): ApiConfig {
  const env = z
    .object({
      NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
      HOST: z.string().default("127.0.0.1"),
      PORT: z.coerce.number().int().positive().default(4000),
      MONGODB_DB: z.string().default("qestra_orchestrator"),
      MONGODB_URI: z.string().optional(),
      REDIS_URL: z.string().optional(),
      LLM_API_KEY: z.string().optional(),
      LLM_BASE_URL: z.string().optional(),
      LLM_PROVIDER: z.enum(["mock", "openai-compatible", "anthropic"]).default("mock"),
      LLM_MODEL: z.string().default("mock"),
      ENCRYPTION_SECRET: z.string().optional(),
      API_AUTH_TOKEN: z.string().optional(),
      CORS_ORIGINS: z.string().default("http://127.0.0.1:4173,http://localhost:4173"),
      QESTRA_WORKSPACE_DIR: z.string().optional(),
      QESTRA_SHELL_ALLOWLIST: z.string().default(""),
      QESTRA_HTTP_ALLOW_HOSTS: z.string().default(""),
      QESTRA_HTTP_DENY_HOSTS: z.string().default(""),
      QESTRA_MAX_RUNTIME_STEPS: z.coerce.number().int().positive().default(30),
      QESTRA_AUTO_HEARTBEAT_SECONDS: z.coerce.number().int().nonnegative().default(0)
    })
    .parse(process.env);

  if (env.NODE_ENV === "production") {
    if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required in production.");
    if (!env.API_AUTH_TOKEN || env.API_AUTH_TOKEN.length < 32) {
      throw new Error("API_AUTH_TOKEN must be at least 32 characters in production.");
    }
    if (!env.ENCRYPTION_SECRET || env.ENCRYPTION_SECRET.length < 32) {
      throw new Error("ENCRYPTION_SECRET must be at least 32 characters in production.");
    }
  }

  const workspaceDir = resolve(env.QESTRA_WORKSPACE_DIR ?? "./workspace");

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    mongoDbName: env.MONGODB_DB,
    mongoUri: env.MONGODB_URI,
    redisUrl: env.REDIS_URL,
    fallbackApiKey: env.LLM_API_KEY,
    fallbackBaseUrl: env.LLM_BASE_URL,
    defaultProvider: env.LLM_PROVIDER,
    defaultModel: env.LLM_MODEL,
    encryptionSecret: env.ENCRYPTION_SECRET ?? "dev-only-change-me-before-production",
    apiAuthToken: env.API_AUTH_TOKEN,
    corsOrigins: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    workspaceDir,
    shellAllowlist: splitCsv(env.QESTRA_SHELL_ALLOWLIST),
    httpAllowHosts: splitCsv(env.QESTRA_HTTP_ALLOW_HOSTS),
    httpDenyHosts: splitCsv(env.QESTRA_HTTP_DENY_HOSTS),
    maxRuntimeSteps: env.QESTRA_MAX_RUNTIME_STEPS,
    autoHeartbeatSeconds: env.QESTRA_AUTO_HEARTBEAT_SECONDS
  };
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}
