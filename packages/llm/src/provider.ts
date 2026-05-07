export interface PromptInput {
  system: string;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface LLMProvider {
  name: string;
  generate(input: PromptInput): Promise<LLMResponse>;
}

export class MockLLMProvider implements LLMProvider {
  name = "mock";

  async generate(input: PromptInput): Promise<LLMResponse> {
    const latest = input.messages.at(-1)?.content ?? "";

    return {
      content: `Plan next governed action for: ${latest}`,
      inputTokens: 240,
      outputTokens: 80,
      costCents: 3
    };
  }
}

export class OpenAIProvider implements LLMProvider {
  name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-4.1-mini"
  ) {}

  async generate(input: PromptInput): Promise<LLMResponse> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: input.system }, ...input.messages],
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 700
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;

    return {
      content: body.choices?.[0]?.message?.content ?? "",
      inputTokens,
      outputTokens,
      costCents: estimateCostCents(inputTokens, outputTokens, 0.4, 1.6)
    };
  }
}

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly model = "claude-3-5-haiku-latest"
  ) {}

  async generate(input: PromptInput): Promise<LLMResponse> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        system: input.system,
        messages: input.messages.filter((message) => message.role !== "tool"),
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 700
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;

    return {
      content: body.content?.map((part) => part.text ?? "").join("") ?? "",
      inputTokens,
      outputTokens,
      costCents: estimateCostCents(inputTokens, outputTokens, 0.8, 4)
    };
  }
}

function estimateCostCents(inputTokens: number, outputTokens: number, inputDollarsPerMillion: number, outputDollarsPerMillion: number) {
  const dollars = (inputTokens / 1_000_000) * inputDollarsPerMillion + (outputTokens / 1_000_000) * outputDollarsPerMillion;
  return Math.max(1, Math.ceil(dollars * 100));
}
