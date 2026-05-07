import type { ApiConfig } from "../config";
import type { LLMProviderName } from "../domain";
import { AnthropicProvider, MockLLMProvider, OpenAIProvider, type LLMProvider } from "../../../../packages/llm/src/provider";

export function createLLMProvider(config: ApiConfig): LLMProvider {
  if (config.llmProvider === "openai") {
    if (!config.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai.");
    }

    return new OpenAIProvider(config.openaiApiKey);
  }

  if (config.llmProvider === "anthropic") {
    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic.");
    }

    return new AnthropicProvider(config.anthropicApiKey);
  }

  return new MockLLMProvider();
}

export function createLLMProviderFromKey(input: {
  provider: LLMProviderName;
  model: string;
  apiKey?: string;
  fallback: ApiConfig;
}): LLMProvider {
  if (input.provider === "openai") {
    const apiKey = input.apiKey ?? input.fallback.openaiApiKey;
    if (!apiKey) throw new Error("OpenAI API key is not configured for this company.");
    return new OpenAIProvider(apiKey, input.model);
  }

  if (input.provider === "anthropic") {
    const apiKey = input.apiKey ?? input.fallback.anthropicApiKey;
    if (!apiKey) throw new Error("Anthropic API key is not configured for this company.");
    return new AnthropicProvider(apiKey, input.model);
  }

  return new MockLLMProvider();
}
