/**
 * Provider-agnostic LLM abstraction with tool / function calling support.
 *
 * One LLMProvider interface, three concrete implementations:
 *  - MockLLMProvider — deterministic fake used when no key is set. It pattern-matches
 *    the task to demo each real tool so the dashboard is interesting offline.
 *  - OpenAICompatibleProvider — anything that speaks the OpenAI Chat Completions API.
 *    Defaults to OpenAI; pass `baseUrl` to point at Groq, Nvidia NIM, Together, OpenRouter,
 *    Ollama, vLLM, etc.
 *  - AnthropicProvider — Claude messages API with native tool_use blocks.
 */

export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LLMToolCallRequest[] }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

export interface LLMToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's argument object. */
  parameters: Record<string, unknown>;
}

export interface LLMGenerateInput {
  system?: string;
  messages: LLMMessage[];
  tools?: LLMToolSpec[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMGenerateResult {
  /** Free-form assistant text. Empty when the model only emitted tool calls. */
  content: string;
  toolCalls: LLMToolCallRequest[];
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  finishReason: "stop" | "tool_calls" | "length" | "other";
}

export interface LLMProvider {
  name: string;
  generate(input: LLMGenerateInput): Promise<LLMGenerateResult>;
}

// ---------------------------------------------------------------------------
// Mock provider — drives the demo without needing keys.
// ---------------------------------------------------------------------------

export class MockLLMProvider implements LLMProvider {
  name = "mock";

  async generate(input: LLMGenerateInput): Promise<LLMGenerateResult> {
    const lastUser = [...input.messages].reverse().find((message) => message.role === "user");
    const lastTool = [...input.messages].reverse().find((message) => message.role === "tool");
    const userText = (lastUser && "content" in lastUser ? lastUser.content : "").toLowerCase();

    // If we just got a tool result, wrap up with a short completion message.
    if (lastTool) {
      return text(`Done. Used ${lastTool.toolName} successfully.`, 80, 30);
    }

    const tools = new Set((input.tools ?? []).map((tool) => tool.name));
    const want = (name: string) => tools.has(name);

    if (/shell|deploy|delete/.test(userText) && want("shell.exec")) {
      return call("shell.exec", { command: "echo demo" }, "Requesting shell access.");
    }
    if (/fetch|http|url|api/.test(userText) && want("http.fetch")) {
      return call("http.fetch", { url: "https://example.com", method: "GET" }, "Fetching reference page.");
    }
    if (/note|remember|save/.test(userText) && want("notes.set")) {
      return call("notes.set", { key: "demo", value: userText.slice(0, 80) }, "Saving a note.");
    }
    if (/read|file|inspect/.test(userText) && want("file.list")) {
      return call("file.list", { path: "." }, "Listing workspace files.");
    }

    return text(`Plan: ${userText.slice(0, 120) || "no input"}`, 60, 25);
  }
}

function text(content: string, inputTokens: number, outputTokens: number): LLMGenerateResult {
  return { content, toolCalls: [], inputTokens, outputTokens, costCents: 1, finishReason: "stop" };
}

function call(name: string, args: Record<string, unknown>, preface: string): LLMGenerateResult {
  return {
    content: preface,
    toolCalls: [{ id: `mock_${name}_${Date.now().toString(36)}`, name, arguments: args }],
    inputTokens: 120,
    outputTokens: 40,
    costCents: 2,
    finishReason: "tool_calls"
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (OpenAI, Groq, Nvidia NIM, Together, Ollama, …)
// ---------------------------------------------------------------------------

export interface OpenAICompatibleOptions {
  apiKey: string;
  model: string;
  /** Defaults to https://api.openai.com/v1. Override for Groq, Together, Ollama, etc. */
  baseUrl?: string;
  /** Per-million-token prices. Best-effort cost estimate. */
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly inputPrice: number;
  private readonly outputPrice: number;

  constructor(options: OpenAICompatibleOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.inputPrice = options.inputPricePerMillion ?? 0.4;
    this.outputPrice = options.outputPricePerMillion ?? 1.6;
    this.name = inferProviderName(this.baseUrl);
  }

  async generate(input: LLMGenerateInput): Promise<LLMGenerateResult> {
    const messages: Array<Record<string, unknown>> = [];
    if (input.system) {
      messages.push({ role: "system", content: input.system });
    }
    for (const message of input.messages) {
      if (message.role === "tool") {
        messages.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
      } else if (message.role === "assistant") {
        messages.push({
          role: "assistant",
          content: message.content,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) }
                }))
              }
            : {})
        });
      } else {
        messages.push({ role: message.role, content: message.content });
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 1024
    };

    if (input.tools && input.tools.length > 0) {
      body.tools = input.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      }));
      body.tool_choice = "auto";
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${this.name} request failed: ${response.status} ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = data.choices?.[0];
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const toolCalls = (choice?.message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: safeParseJson(call.function.arguments)
    }));

    return {
      content: choice?.message?.content ?? "",
      toolCalls,
      inputTokens,
      outputTokens,
      costCents: estimateCostCents(inputTokens, outputTokens, this.inputPrice, this.outputPrice),
      finishReason: normalizeFinishReason(choice?.finish_reason)
    };
  }
}

// ---------------------------------------------------------------------------
// Anthropic provider with tool_use support.
// ---------------------------------------------------------------------------

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly inputPrice: number;
  private readonly outputPrice: number;

  constructor(options: AnthropicOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
    this.inputPrice = options.inputPricePerMillion ?? 0.8;
    this.outputPrice = options.outputPricePerMillion ?? 4;
  }

  async generate(input: LLMGenerateInput): Promise<LLMGenerateResult> {
    // Anthropic wants alternating user/assistant messages, with tool_result blocks
    // packaged into user messages. We rebuild from our normalized message list.
    const messages: Array<Record<string, unknown>> = [];
    for (const message of input.messages) {
      if (message.role === "system") {
        // Hoisted to top-level "system" param below.
        continue;
      }
      if (message.role === "tool") {
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId,
              content: message.content
            }
          ]
        });
        continue;
      }
      if (message.role === "assistant") {
        const blocks: Array<Record<string, unknown>> = [];
        if (message.content) blocks.push({ type: "text", text: message.content });
        for (const call of message.toolCalls ?? []) {
          blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
        }
        messages.push({ role: "assistant", content: blocks.length > 0 ? blocks : message.content });
        continue;
      }
      messages.push({ role: "user", content: message.content });
    }

    const body: Record<string, unknown> = {
      model: this.model,
      system: input.system,
      messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 1024
    };

    if (input.tools && input.tools.length > 0) {
      body.tools = input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Anthropic request failed: ${response.status} ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      content?: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      >;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };

    const textParts: string[] = [];
    const toolCalls: LLMToolCallRequest[] = [];
    for (const block of data.content ?? []) {
      if (block.type === "text") textParts.push(block.text);
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
      }
    }

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    return {
      content: textParts.join("\n"),
      toolCalls,
      inputTokens,
      outputTokens,
      costCents: estimateCostCents(inputTokens, outputTokens, this.inputPrice, this.outputPrice),
      finishReason:
        data.stop_reason === "tool_use"
          ? "tool_calls"
          : data.stop_reason === "end_turn" || data.stop_reason === "stop_sequence"
            ? "stop"
            : data.stop_reason === "max_tokens"
              ? "length"
              : "other"
    };
  }
}

// ---------------------------------------------------------------------------

function safeParseJson(input: string): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeFinishReason(reason: string | undefined): LLMGenerateResult["finishReason"] {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  if (reason === "stop") return "stop";
  return "other";
}

function inferProviderName(baseUrl: string): string {
  const host = baseUrl.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  if (host.includes("openai")) return "openai";
  if (host.includes("groq")) return "groq";
  if (host.includes("nvidia") || host.includes("nim")) return "nvidia";
  if (host.includes("together")) return "together";
  if (host.includes("openrouter")) return "openrouter";
  if (host.includes("ollama") || host.includes("localhost") || host.includes("127.0.0.1")) return "ollama";
  return "openai-compatible";
}

function estimateCostCents(
  inputTokens: number,
  outputTokens: number,
  inputDollarsPerMillion: number,
  outputDollarsPerMillion: number
) {
  const dollars =
    (inputTokens / 1_000_000) * inputDollarsPerMillion + (outputTokens / 1_000_000) * outputDollarsPerMillion;
  return Math.max(1, Math.ceil(dollars * 100));
}
