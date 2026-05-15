import "dotenv/config";
import { z } from "zod";

export interface ApiConfig {
  host: string;
  port: number;
  nodeEnv: "development" | "test" | "production";
  mongoDbName: string;
  mongoUri?: string;
  redisUrl?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  llmProvider: "mock" | "openai" | "anthropic";
  encryptionSecret: string;
  apiAuthToken?: string;
  corsOrigins: string[];
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
      OPENAI_API_KEY: z.string().optional(),
      ANTHROPIC_API_KEY: z.string().optional(),
      LLM_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
      ENCRYPTION_SECRET: z.string().optional(),
      API_AUTH_TOKEN: z.string().optional(),
      CORS_ORIGINS: z.string().default("http://127.0.0.1:4173,http://localhost:4173")
    })
    .parse(process.env);

  if (env.NODE_ENV === "production") {
    if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required in production.");
    if (!env.API_AUTH_TOKEN || env.API_AUTH_TOKEN.length < 32) throw new Error("API_AUTH_TOKEN must be at least 32 characters in production.");
    if (!env.ENCRYPTION_SECRET || env.ENCRYPTION_SECRET.length < 32) {
      throw new Error("ENCRYPTION_SECRET must be at least 32 characters in production.");
    }
  }

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    mongoDbName: env.MONGODB_DB,
    mongoUri: env.MONGODB_URI,
    redisUrl: env.REDIS_URL,
    openaiApiKey: env.OPENAI_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    llmProvider: env.LLM_PROVIDER,
    encryptionSecret: env.ENCRYPTION_SECRET ?? "dev-only-change-me-before-production",
    apiAuthToken: env.API_AUTH_TOKEN,
    corsOrigins: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  };
}
