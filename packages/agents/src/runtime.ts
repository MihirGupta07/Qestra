/**
 * The agent runtime is the core loop. It is intentionally pure: it takes an LLM
 * provider, a tool router, the current conversation state, and produces a
 * decision + an updated state. It does not touch the database.
 *
 * The repository layer is responsible for persisting the state, surfacing
 * approval requests to the UI, and resuming the loop when a human responds.
 */

import type {
  LLMGenerateResult,
  LLMMessage,
  LLMProvider,
  LLMToolCallRequest,
  LLMToolSpec
} from "../../llm/src/provider";
import type { ToolRouter } from "../../tools/src/tool-router";
import type { ToolDefinition } from "../../tools/src/types";

export interface RuntimeAgent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  toolScopes: string[];
}

export interface RuntimeTask {
  id: string;
  title: string;
  goal: string;
}

/** Persisted between heartbeats so an execution can survive approval pauses. */
export interface RuntimeState {
  messages: LLMMessage[];
  stepsUsed: number;
  pendingApprovalToolCall?: PendingToolCall;
}

export interface PendingToolCall {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requestedScope: string;
}

export type RuntimeEvent =
  | { kind: "assistant_message"; text: string }
  | { kind: "tool_call_started"; callId: string; toolName: string; arguments: Record<string, unknown>; sensitive: boolean }
  | { kind: "tool_call_result"; callId: string; toolName: string; ok: boolean; output: string; data?: unknown; errorMessage?: string }
  | { kind: "tool_call_denied"; callId: string; toolName: string; reason: string }
  | { kind: "tool_call_pending_approval"; callId: string; toolName: string; arguments: Record<string, unknown> }
  | { kind: "completed"; summary: string }
  | { kind: "failed"; errorMessage: string }
  | { kind: "max_steps_reached"; stepsUsed: number };

export type RuntimeStatus = "completed" | "waiting_for_approval" | "failed" | "max_steps";

export interface RuntimeOutcome {
  status: RuntimeStatus;
  state: RuntimeState;
  events: RuntimeEvent[];
  costCents: number;
}

export interface RuntimeOptions {
  maxSteps?: number;
  /** Override the default per-call max output tokens. */
  maxTokens?: number;
  systemPromptPrefix?: string;
}

export class AgentRuntime {
  private readonly maxSteps: number;
  private readonly maxTokens: number;
  private readonly systemPromptPrefix: string;

  constructor(
    private readonly llm: LLMProvider,
    private readonly toolRouter: ToolRouter,
    options: RuntimeOptions = {}
  ) {
    this.maxSteps = options.maxSteps ?? 6;
    this.maxTokens = options.maxTokens ?? 1024;
    this.systemPromptPrefix =
      options.systemPromptPrefix ??
      "You are an autonomous worker inside the Qestra orchestration platform. " +
        "You operate inside governance limits: tools have RBAC scopes, and sensitive tools require human approval before they run. " +
        "Plan briefly, then either call a tool or return a final answer. Keep responses tight.";
  }

  /** Start a fresh execution from a task. */
  start(input: { agent: RuntimeAgent; task: RuntimeTask }): Promise<RuntimeOutcome> {
    const state: RuntimeState = {
      messages: [
        {
          role: "user",
          content: `Task: ${input.task.title}\nGoal: ${input.task.goal}\n\nProceed using the available tools as needed, then summarize what you did.`
        }
      ],
      stepsUsed: 0
    };
    return this.drive(input.agent, state);
  }

  /**
   * Resume after a human responded to an approval request.
   * - approved: execute the pending tool, feed result back, continue the loop.
   * - rejected: feed a synthetic "denied by human" tool result so the model can replan.
   */
  async resume(input: {
    agent: RuntimeAgent;
    state: RuntimeState;
    decision: "approved" | "rejected";
    executionId: string;
  }): Promise<RuntimeOutcome> {
    const pending = input.state.pendingApprovalToolCall;
    if (!pending) {
      return {
        status: "failed",
        state: input.state,
        events: [{ kind: "failed", errorMessage: "resume called without a pending tool call" }],
        costCents: 0
      };
    }

    const events: RuntimeEvent[] = [];
    const nextState: RuntimeState = {
      messages: [...input.state.messages],
      stepsUsed: input.state.stepsUsed,
      pendingApprovalToolCall: undefined
    };

    if (input.decision === "rejected") {
      const message: LLMMessage = {
        role: "tool",
        toolCallId: pending.callId,
        toolName: pending.toolName,
        content: "denied by human approver — choose a different plan or stop"
      };
      nextState.messages.push(message);
      events.push({
        kind: "tool_call_result",
        callId: pending.callId,
        toolName: pending.toolName,
        ok: false,
        output: "denied by human approver",
        errorMessage: "rejected"
      });
    } else {
      const result = await this.toolRouter.execute(pending.toolName, pending.arguments, {
        executionId: input.executionId,
        agentId: input.agent.id,
        companyId: input.agent.companyId
      });
      nextState.messages.push({
        role: "tool",
        toolCallId: pending.callId,
        toolName: pending.toolName,
        content: result.output
      });
      events.push({
        kind: "tool_call_result",
        callId: pending.callId,
        toolName: pending.toolName,
        ok: result.ok,
        output: result.output,
        data: result.data,
        errorMessage: result.errorMessage
      });
    }

    const continued = await this.drive(input.agent, nextState);
    return {
      ...continued,
      events: [...events, ...continued.events]
    };
  }

  // -------------------------------------------------------------------------
  // Internal driver — runs the LLM/tool loop until completion, approval pause,
  // failure, or max steps.
  // -------------------------------------------------------------------------

  private async drive(agent: RuntimeAgent, initialState: RuntimeState): Promise<RuntimeOutcome> {
    const events: RuntimeEvent[] = [];
    const state: RuntimeState = {
      messages: [...initialState.messages],
      stepsUsed: initialState.stepsUsed,
      pendingApprovalToolCall: undefined
    };

    let totalCost = 0;
    const availableTools = this.toolRouter.toolsForAgent(agent);
    const toolSpecs = availableTools.map(toLLMToolSpec);
    const systemPrompt = this.buildSystemPrompt(agent, availableTools);

    while (state.stepsUsed < this.maxSteps) {
      state.stepsUsed += 1;

      let result: LLMGenerateResult;
      try {
        result = await this.llm.generate({
          system: systemPrompt,
          messages: state.messages,
          tools: toolSpecs.length > 0 ? toolSpecs : undefined,
          maxTokens: this.maxTokens
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        events.push({ kind: "failed", errorMessage: `LLM call failed: ${message}` });
        return { status: "failed", state, events, costCents: totalCost };
      }

      totalCost += result.costCents;

      if (result.content) {
        events.push({ kind: "assistant_message", text: result.content });
      }
      state.messages.push({
        role: "assistant",
        content: result.content,
        ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {})
      });

      if (result.toolCalls.length === 0) {
        events.push({ kind: "completed", summary: result.content || "(no output)" });
        return { status: "completed", state, events, costCents: totalCost };
      }

      // Process tool calls in order. If any is sensitive, we pause for approval
      // after handling any non-sensitive ones up to that point.
      for (const call of result.toolCalls) {
        const decision = this.toolRouter.route(agent, call.name);

        if (decision.status === "denied") {
          events.push({ kind: "tool_call_denied", callId: call.id, toolName: call.name, reason: decision.reason });
          state.messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: `denied: ${decision.reason}`
          });
          continue;
        }

        if (decision.status === "approval_required") {
          state.pendingApprovalToolCall = {
            callId: call.id,
            toolName: call.name,
            arguments: call.arguments,
            requestedScope: decision.tool.requiredScope
          };
          events.push({
            kind: "tool_call_pending_approval",
            callId: call.id,
            toolName: call.name,
            arguments: call.arguments
          });
          return { status: "waiting_for_approval", state, events, costCents: totalCost };
        }

        events.push({
          kind: "tool_call_started",
          callId: call.id,
          toolName: call.name,
          arguments: call.arguments,
          sensitive: false
        });
        const execResult = await this.toolRouter.execute(call.name, call.arguments, {
          executionId: "runtime", // overridden by repository wrapper if needed
          agentId: agent.id,
          companyId: agent.companyId
        });
        events.push({
          kind: "tool_call_result",
          callId: call.id,
          toolName: call.name,
          ok: execResult.ok,
          output: execResult.output,
          data: execResult.data,
          errorMessage: execResult.errorMessage
        });
        state.messages.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: execResult.output
        });
      }
    }

    events.push({ kind: "max_steps_reached", stepsUsed: state.stepsUsed });
    return { status: "max_steps", state, events, costCents: totalCost };
  }

  private buildSystemPrompt(agent: RuntimeAgent, availableTools: ToolDefinition[]): string {
    const lines = [
      this.systemPromptPrefix,
      `Your name is ${agent.name}. Role: ${agent.role}.`
    ];
    if (availableTools.length > 0) {
      lines.push(
        `Available tools: ${availableTools.map((tool) => tool.name).join(", ")}.`,
        "Sensitive tools will pause for human approval before executing — that is expected, not an error."
      );
    } else {
      lines.push("You have no tools available. Reply with your reasoning and a final answer only.");
    }
    return lines.join("\n");
  }
}

function toLLMToolSpec(tool: ToolDefinition): LLMToolSpec {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

// Re-export for convenience.
export type { LLMToolCallRequest, LLMMessage };
