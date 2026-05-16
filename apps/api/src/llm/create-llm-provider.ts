import type { ApiConfig } from "../config";
import type { LLMProviderName } from "../domain";
import {
  AnthropicProvider,
  MockLLMProvider,
  OpenAICompatibleProvider,
  type LLMProvider
} from "../../../../packages/llm/src/provider";

export interface CreateProviderInput {
  provider: LLMProviderName;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fallback: ApiConfig;
}

export function createLLMProviderFromKey(input: CreateProviderInput): LLMProvider {
  if (input.provider === "mock") {
    return new MockLLMProvider();
  }

  const apiKey = input.apiKey ?? input.fallback.fallbackApiKey;
  if (!apiKey) {
    throw new Error(`${input.provider} requires an API key (set it in Provider Keys or LLM_API_KEY).`);
  }

  if (input.provider === "anthropic") {
    return new AnthropicProvider({
      apiKey,
      model: input.model,
      baseUrl: input.baseUrl ?? input.fallback.fallbackBaseUrl
    });
  }

  // openai-compatible — also serves OpenAI itself, Groq, Nvidia NIM, Together,
  // OpenRouter, Ollama, etc. baseUrl selects which.
  return new OpenAICompatibleProvider({
    apiKey,
    model: input.model,
    baseUrl: input.baseUrl ?? input.fallback.fallbackBaseUrl
  });
}
