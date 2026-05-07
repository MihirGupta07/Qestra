import type { ApiConfig } from "../config";
import type { OrchestratorRepository } from "../repositories/orchestrator-repository";
import { decryptSecret } from "../security/secrets";
import { createLLMProviderFromKey } from "./create-llm-provider";

export async function resolveCompanyLLMProvider(repository: OrchestratorRepository, config: ApiConfig) {
  const settings = await repository.getProviderSettings();
  const apiKey = settings.encryptedApiKey ? decryptSecret(settings.encryptedApiKey, config.encryptionSecret) : undefined;

  return createLLMProviderFromKey({
    provider: settings.provider,
    model: settings.model,
    apiKey,
    fallback: config
  });
}
