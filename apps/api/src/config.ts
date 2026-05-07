import "dotenv/config";

export interface ApiConfig {
  host: string;
  port: number;
  mongoDbName: string;
  mongoUri?: string;
  redisUrl?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  llmProvider: "mock" | "openai" | "anthropic";
  encryptionSecret: string;
}

export function readConfig(): ApiConfig {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 4000),
    mongoDbName: process.env.MONGODB_DB ?? "qestra_orchestrator",
    mongoUri: process.env.MONGODB_URI,
    redisUrl: process.env.REDIS_URL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    llmProvider: (process.env.LLM_PROVIDER as "mock" | "openai" | "anthropic" | undefined) ?? "mock",
    encryptionSecret: process.env.ENCRYPTION_SECRET ?? "dev-only-change-me-before-production"
  };
}
